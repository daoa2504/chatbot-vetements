import {NextRequest, NextResponse} from 'next/server';
import {Prisma} from '@prisma/client';
import {groq} from '@/lib/groq';
import {prisma} from '@/lib/prisma';
import {generateEmbedding} from '@/lib/embeddings';

// Types
interface ChatRequest {
    message: string;
    sessionId?: string;
}

interface ParsedNeeds {
    type_produit: string;
    // null = le client ne l'a précisé nulle part dans la conversation.
    // Pas de valeur par défaut déguisée : le bot ne doit jamais parler d'un budget inventé.
    quantite: number | null;
    budget_par_unite: number | null;
    deadline_jours?: number;
    sport_ou_activite?: string;
    autres_besoins?: string;
    show_all_options?: boolean;
}

interface HistoryMessage {
    role: 'user' | 'assistant';
    content: string;
}

const HISTORY_LIMIT = 10;
const HISTORY_MESSAGE_MAX_CHARS = 1500;

// llama-3.3-70b-versatile a été retiré par Groq. gpt-oss raisonne avant de répondre :
// effort bas pour garder la latence, et max_tokens assez large pour raisonnement + réponse.
const CHAT_MODEL = 'openai/gpt-oss-120b';

const DISPLAYED_COUNT = 3;
const SHOW_ALL_COUNT = 10;

interface BudgetInfo {
    // false quand le client n'a pas donné de budget : aucune notion de « dans le budget »
    hasBudget: boolean;
    withinBudgetCount: number;
    // Aucun produit dans le budget : ceux affichés sont les plus proches, au-dessus
    noneWithinBudget: boolean;
    // Produits pertinents non affichés, séparés pour ne pas dire « hors budget » à tort
    moreWithinBudgetCount: number;
    aboveBudgetCount: number;
    aboveBudgetPriceRange: {
        min: number;
        max: number;
    } | null;
}

const NO_BUDGET_INFO: BudgetInfo = {
    hasBudget: false,
    withinBudgetCount: 0,
    noneWithinBudget: false,
    moreWithinBudgetCount: 0,
    aboveBudgetCount: 0,
    aboveBudgetPriceRange: null,
};

export async function POST(request: NextRequest) {
    try {
        const { message, sessionId }: ChatRequest = await request.json();

        if (!message || message.trim() === '') {
            return NextResponse.json(
                { error: 'Message requis' },
                { status: 400 }
            );
        }

        // Créer ou récupérer la session
        let session;
        if (sessionId) {
            session = await prisma.chatSession.findUnique({
                where: { id: sessionId },
            });
        }
        if (!session) {
            session = await prisma.chatSession.create({
                data: {},
            });
        }

        // Historique récent de la session (avant le message courant), pour que le bot
        // se souvienne du type, de la quantité et du budget déjà donnés
        const previousMessages = await prisma.chatMessage.findMany({
            where: { sessionId: session.id },
            orderBy: { createdAt: 'desc' },
            take: HISTORY_LIMIT,
        });
        const history: HistoryMessage[] = previousMessages.reverse().map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content.slice(0, HISTORY_MESSAGE_MAX_CHARS),
        }));

        // Sauvegarder le message utilisateur
        await prisma.chatMessage.create({
            data: {
                sessionId: session.id,
                role: 'user',
                content: message,
                recommendedProducts: [],
            },
        });

        // Étape 1 : Parser les besoins avec Groq
        const parsedNeeds = await parseUserNeeds(message, history);

        // Étape 2 : Chercher les produits correspondants (avec RAG vectoriel).
        // Les messages précédents du client enrichissent la recherche : « oui, montre-les »
        // seul ne dit rien sur le produit voulu.
        const userConversation = [
            ...history.filter((m) => m.role === 'user').map((m) => m.content),
            message,
        ].join('\n');
        const { products: matchingProducts, budgetInfo } = await findMatchingProducts(parsedNeeds, userConversation);

        // Étape 3 : Générer une réponse personnalisée
        const aiResponse = await generateRecommendation(
            message,
            parsedNeeds,
            matchingProducts,
            budgetInfo,
            history
        );

        // Sauvegarder la réponse de l'assistant
        await prisma.chatMessage.create({
            data: {
                sessionId: session.id,
                role: 'assistant',
                content: aiResponse,
                recommendedProducts: matchingProducts.map((p) => p.id),
            },
        });

        return NextResponse.json({
            sessionId: session.id,
            message: aiResponse,
            products: matchingProducts.slice(0, SHOW_ALL_COUNT),
            parsedNeeds,
        });
    } catch (error) {
        console.error('Erreur API chat:', error);
        return NextResponse.json(
            { error: 'Erreur lors du traitement' },
            { status: 500 }
        );
    }
}

// Fonction 1 : Parser les besoins du client avec l'IA
async function parseUserNeeds(message: string, history: HistoryMessage[]): Promise<ParsedNeeds> {
    const conversation = history
        .map((m) => `${m.role === 'user' ? 'Client' : 'Conseiller'} : ${m.content}`)
        .join('\n\n');

    const completion = await groq.chat.completions.create({
        messages: [
            {
                role: 'system',
                content: `Tu es un expert en extraction d'informations pour vêtements d'équipe.
Extrait les besoins du client à partir de TOUTE la conversation et réponds UNIQUEMENT en JSON valide (sans markdown, sans backticks).

Les besoins s'accumulent au fil de la conversation : si le client a donné le type, la quantité,
le budget ou le délai dans un message précédent, CONSERVE ces valeurs, sauf s'il les change
explicitement dans son dernier message.

N'INVENTE JAMAIS de valeur : si une information n'a été donnée par le CLIENT nulle part dans la
conversation, mets null. Les prix cités par le conseiller ne sont pas un budget du client.

Format :
{
  "type_produit": "hoodie/tshirt/veste/polo/short/casquette/autre",
  "quantite": nombre de pièces voulues, ou null si jamais mentionné (ex. "25 hoodies" → 25, "on est 30" → 30),
  "budget_par_unite": budget en dollars PAR PIÈCE, ou null si jamais mentionné
                      (si le client donne un budget total et une quantité, divise ; budget total sans quantité → null),
  "deadline_jours": nombre de jours, ou null si jamais mentionné,
  "sport_ou_activite": "string" ou null,
  "autres_besoins": "string" ou null,
  "show_all_options": boolean (true si l'utilisateur veut voir TOUTES les options)
}

Contrairement aux autres champs, "show_all_options" ne s'accumule PAS : il dépend UNIQUEMENT
du dernier message. Une demande de voir toutes les options faite plus tôt dans la conversation
ne compte plus.

Mets "show_all_options": true si le DERNIER message dit :
- "Oui je veux voir les autres"
- "Montre-moi tout"
- "Affiche les 11"
- "Je veux voir les options premium"
- "Montre-moi les alternatives"
- Toute variante demandant à voir plus d'options

Exemples:
- "On veut 25 hoodies"
  → {"type_produit":"hoodie","quantite":25,"budget_par_unite":null,"deadline_jours":null,"show_all_options":false}

- "On veut 25 hoodies pour notre équipe de soccer, budget 60$ chacun"
  → {"type_produit":"hoodie","quantite":25,"budget_par_unite":60,"sport_ou_activite":"soccer","show_all_options":false}

- Conversation précédente : "On veut 25 hoodies pour notre équipe de soccer, budget 60$ chacun"
  Dernier message : "Oui je veux afficher les 11"
  → {"type_produit":"hoodie","quantite":25,"budget_par_unite":60,"sport_ou_activite":"soccer","show_all_options":true}

- Conversation précédente : "Des t-shirts pour 40 personnes, max 20$" puis "Montre-moi toutes les options"
  Dernier message : "Finalement on sera 60"
  → {"type_produit":"tshirt","quantite":60,"budget_par_unite":20,"show_all_options":false}

- Aucune conversation précédente
  Dernier message : "Montre-moi toutes les options"
  → {"type_produit":"autre","quantite":null,"budget_par_unite":null,"show_all_options":true}`,
            },
            {
                role: 'user',
                content: `${conversation ? `Conversation précédente :\n${conversation}\n\n` : 'Aucune conversation précédente.\n\n'}Dernier message du client :\n${message}`,
            },
        ],
        model: CHAT_MODEL,
        reasoning_effort: 'low',
        temperature: 0.2,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
    });

    const text = completion.choices[0]?.message?.content || '{}';
    const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    try {
        return sanitizeNeeds(JSON.parse(cleanText));
    } catch (e) {
        console.error('Erreur parsing besoins:', text);
        return sanitizeNeeds({});
    }
}

// Le JSON vient du LLM : on ne garde que des valeurs du bon type, dans des bornes
// raisonnables, avant qu'elles servent dans la requête SQL et les calculs de budget.
function sanitizeNeeds(raw: any): ParsedNeeds {
    const positiveInt = (value: unknown, max: number): number | undefined => {
        if (value === null || value === undefined || value === '') return undefined;
        const n = Math.round(Number(value));
        return Number.isFinite(n) && n > 0 && n <= max ? n : undefined;
    };
    const positiveNumber = (value: unknown, max: number): number | undefined => {
        if (value === null || value === undefined || value === '') return undefined;
        const n = Number(value);
        return Number.isFinite(n) && n > 0 && n <= max ? n : undefined;
    };
    const text = (value: unknown): string | undefined =>
        typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : undefined;

    return {
        type_produit: text(raw?.type_produit) ?? 'autre',
        quantite: positiveInt(raw?.quantite, 100000) ?? null,
        budget_par_unite: positiveNumber(raw?.budget_par_unite, 100000) ?? null,
        deadline_jours: positiveInt(raw?.deadline_jours, 3650),
        sport_ou_activite: text(raw?.sport_ou_activite),
        autres_besoins: text(raw?.autres_besoins),
        show_all_options: raw?.show_all_options === true,
    };
}

// Fonction 2 : Chercher les produits avec RAG vectoriel (pgvector)
async function findMatchingProducts(needs: ParsedNeeds, originalMessage: string): Promise<{
    products: any[];
    budgetInfo: BudgetInfo;
}> {
    const { type_produit, quantite, budget_par_unite, deadline_jours, autres_besoins } = needs;

    const searchQuery = `
    Demande client: ${originalMessage}
    Type: ${type_produit}
    Sport/activité: ${needs.sport_ou_activite || ''}
    Autres besoins: ${autres_besoins || ''}
  `.trim();

    const queryEmbedding = await generateEmbedding(searchQuery);
    const embeddingVector = JSON.stringify(queryEmbedding);

    // Toutes les valeurs passent en paramètres liés : elles viennent du LLM,
    // donc indirectement de l'utilisateur, et ne doivent jamais être concaténées au SQL.
    const quantityCondition = quantite
        ? Prisma.sql`AND "minQty" <= ${quantite} AND "maxQty" >= ${quantite}`
        : Prisma.empty;
    const deadlineCondition = deadline_jours
        ? Prisma.sql`AND "leadTime" <= ${deadline_jours}`
        : Prisma.empty;

    const products = await prisma.$queryRaw<any[]>`
        SELECT
            id, name, type, price, "minQty", "maxQty", "leadTime",
            description, tags, customization, sizes, colors,
            "stockQuebec", "stockMontreal",
            1 - (embedding <=> ${embeddingVector}::vector) as similarity
        FROM "Product"
        WHERE embedding IS NOT NULL
            ${quantityCondition}
            ${deadlineCondition}
        ORDER BY similarity DESC
            LIMIT 20
    `;

    if (products.length === 0) {
        const fallbackProducts = await prisma.product.findMany({
            orderBy: { price: 'asc' },
            take: 5,
        });
        return { products: fallbackProducts, budgetInfo: NO_BUDGET_INFO };
    }

    // SI L'UTILISATEUR VEUT VOIR TOUTES LES OPTIONS : les 10 meilleurs par similarité, tous types
    if (needs.show_all_options) {
        return {
            products: products.slice(0, SHOW_ALL_COUNT),
            budgetInfo: budget_par_unite === null ? NO_BUDGET_INFO : { ...NO_BUDGET_INFO, hasBudget: true },
        };
    }

    // Le client a demandé un type précis (des vestes) : on reste sur ce type, sinon le filtre
    // de budget fait remonter des shorts ou des casquettes simplement parce qu'ils sont moins chers.
    // On n'élargit aux autres types que si le catalogue n'en a aucun qui convienne.
    const requestedType = normalizeType(type_produit);
    const sameType = products.filter(p => normalizeType(p.type) === requestedType);
    const candidates = requestedType !== 'autre' && sameType.length > 0 ? sameType : products;

    // Sans budget, on ne trie pas « dans / hors budget » : les plus pertinents d'abord
    if (budget_par_unite === null) {
        return { products: candidates.slice(0, DISPLAYED_COUNT), budgetInfo: NO_BUDGET_INFO };
    }

    const withinBudget = candidates.filter(p => p.price <= budget_par_unite);
    const aboveBudget = candidates.filter(p => p.price > budget_par_unite);

    // Sinon, afficher ceux dans le budget ; s'il n'y en a aucun, les moins chers au-dessus
    const noneWithinBudget = withinBudget.length === 0;
    const displayedProducts = noneWithinBudget
        ? [...aboveBudget].sort((a, b) => a.price - b.price).slice(0, DISPLAYED_COUNT)
        : withinBudget.slice(0, DISPLAYED_COUNT);

    const displayedIds = new Set(displayedProducts.map(p => p.id));
    const hiddenAbove = aboveBudget.filter(p => !displayedIds.has(p.id));
    const hiddenAbovePrices = hiddenAbove.map(p => p.price);

    return {
        products: displayedProducts,
        budgetInfo: {
            hasBudget: true,
            withinBudgetCount: withinBudget.length,
            noneWithinBudget,
            moreWithinBudgetCount: Math.max(0, withinBudget.length - DISPLAYED_COUNT),
            aboveBudgetCount: hiddenAbove.length,
            aboveBudgetPriceRange: hiddenAbove.length > 0
                ? { min: Math.round(Math.min(...hiddenAbovePrices)), max: Math.round(Math.max(...hiddenAbovePrices)) }
                : null,
        },
    };
}

// « T-shirt », « t shirt » et « tshirt » désignent le même type ; idem pour les accents
function normalizeType(type: string | null | undefined): string {
    return (type ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z]/g, '')
        .replace(/s$/, '');
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

function productLine(p: any): string {
    return `• ${p.name} - ${p.price}$ : ${p.description.substring(0, 70)}...\n`;
}

// Mode « afficher tout » : liste construite sans LLM, par tranche de prix si on connaît le budget
function buildShowAllResponse(needs: ParsedNeeds, products: any[], missingInfo: string[]): string {
    let response = `Voici toutes les options qui correspondent à votre demande :\n\n`;
    const budget = needs.budget_par_unite;

    if (budget === null) {
        [...products].sort((a, b) => a.price - b.price).forEach(p => { response += productLine(p); });
        response += `\n`;
    } else {
        const sections = [
            { title: `📗 DANS VOTRE BUDGET (≤${budget}$)`, items: products.filter(p => p.price <= budget) },
            {
                title: `📙 LÉGÈREMENT AU-DESSUS (${Math.round(budget * 1.01)}-${Math.round(budget * 1.3)}$)`,
                items: products.filter(p => p.price > budget && p.price <= budget * 1.3),
            },
            { title: `📕 OPTIONS PREMIUM (>${Math.round(budget * 1.3)}$)`, items: products.filter(p => p.price > budget * 1.3) },
        ];
        for (const section of sections) {
            if (section.items.length === 0) continue;
            response += `${section.title} - ${plural(section.items.length, 'option')} :\n`;
            section.items.forEach(p => { response += productLine(p); });
            response += `\n`;
        }
    }

    if (missingInfo.length > 0) {
        response += `💡 Pour vous conseiller plus précisément, pourriez-vous me préciser ${missingInfo.join(' et ')} ?\n\n`;
    } else if (budget !== null) {
        response += `💡 Pour ${needs.quantite} pièces, je vous recommande de comparer d'abord les options dans votre budget de ${budget}$. Les options au-dessus offrent des fonctionnalités supplémentaires qui peuvent justifier l'investissement.\n\n`;
    }
    response += `Souhaitez-vous un devis détaillé pour une option spécifique ?`;

    return response;
}

// Fonction 3 : Générer une recommandation personnalisée
async function generateRecommendation(
    originalMessage: string,
    needs: ParsedNeeds,
    products: any[],
    budgetInfo: BudgetInfo,
    history: HistoryMessage[]
): Promise<string> {

    const missingInfo: string[] = [];
    if (needs.quantite === null) missingInfo.push('le nombre de pièces');
    if (needs.budget_par_unite === null) missingInfo.push('votre budget par pièce');

    if (needs.show_all_options) {
        return buildShowAllResponse(needs, products, missingInfo);
    }

    // Ce que le LLM doit dire sur le budget, selon ce que le client a réellement donné
    let budgetContext: string;
    if (!budgetInfo.hasBudget) {
        budgetContext = `Le client n'a donné AUCUN budget. Ne parle JAMAIS de « votre budget », de « dans le budget »
ou de « hors budget » : présente simplement les produits avec leur prix.`;
    } else if (budgetInfo.noneWithinBudget) {
        budgetContext = `Budget du client : ${needs.budget_par_unite}$ par pièce.
AUCUN produit pertinent n'est dans ce budget. Les produits ci-dessous sont les moins chers au-dessus :
dis-le honnêtement, sans prétendre qu'ils sont dans le budget.`;
    } else {
        const others: string[] = [];
        if (budgetInfo.moreWithinBudgetCount > 0) {
            others.push(`${plural(budgetInfo.moreWithinBudgetCount, 'autre option')} dans le budget`);
        }
        if (budgetInfo.aboveBudgetCount > 0 && budgetInfo.aboveBudgetPriceRange) {
            const { min, max } = budgetInfo.aboveBudgetPriceRange;
            others.push(`${plural(budgetInfo.aboveBudgetCount, 'option')} au-dessus du budget (${min === max ? `${min}$` : `${min}$ à ${max}$`})`);
        }
        budgetContext = `Budget du client : ${needs.budget_par_unite}$ par pièce. Les produits ci-dessous sont tous dans ce budget.
${others.length > 0 ? `Autres options pertinentes NON affichées : ${others.join(' et ')}.
Mentionne-les naturellement à la fin avec ces chiffres exacts et demande s'il veut les voir.` : ''}`;
    }

    const completion = await groq.chat.completions.create({
        messages: [
            {
                role: 'system',
                content: `Tu es un conseiller expert en vêtements d'équipe pour Attraction.

IMPORTANT : Sois CONCIS et NATUREL. Maximum 150 mots.
Écris en texte simple : PAS de markdown (pas de **, pas de #, pas de tableaux). Utilise « • » pour les listes.
N'invente jamais une information que le client n'a pas donnée (quantité, budget, délai).

${missingInfo.length > 0 ? `Le client n'a pas encore précisé : ${missingInfo.join(' et ')}.
Montre quand même 2-3 options, puis demande gentiment ces informations, sans bloquer la conversation.` : `Informations complètes : fais une recommandation précise et personnalisée.`}

Structure :
1. Accueil + reprise de ce que le client a demandé (1-2 lignes, seulement ce qu'il a VRAIMENT dit)
${budgetInfo.noneWithinBudget ? `2. Dis CLAIREMENT et d'abord qu'aucun produit adapté n'est disponible à ${needs.budget_par_unite}$ ou moins, puis présente ceux-ci comme les options les plus abordables :
   • [Nom] - [Prix]$ : [pourquoi c'est adapté]` : `2. 2-3 produits : • [Nom] - [Prix]$ : [pourquoi c'est adapté]`}
${needs.quantite !== null ? `3. Total estimé pour ${needs.quantite} pièces` : '3. (pas de total : la quantité est inconnue)'}
4. ${missingInfo.length > 0 ? `Question amicale pour connaître ${missingInfo.join(' et ')}` : 'Prochaine étape'}

Tiens compte de la conversation précédente : ne répète pas une question déjà posée et ne redemande pas une information déjà donnée.`,
            },
            ...history,
            {
                role: 'user',
                content: `Message du client : "${originalMessage}"

Besoins identifiés (null = non précisé par le client) :
${JSON.stringify(needs, null, 2)}

${budgetContext}

Produits à présenter :
${JSON.stringify(products, null, 2)}`,
            },
        ],
        model: CHAT_MODEL,
        reasoning_effort: 'low',
        temperature: 0.7,
        max_tokens: 1500,
    });

    return completion.choices[0]?.message?.content || 'Désolé, une erreur est survenue.';
}
