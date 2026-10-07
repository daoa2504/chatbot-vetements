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
    quantite: number;
    budget_par_unite: number;
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

const DEFAULT_QUANTITY = 25;
const DEFAULT_BUDGET = 100;

interface BudgetInfo {
    withinBudgetCount: number;
    slightlyAboveCount: number;
    aboveCount: number;
    totalExcludedCount: number;
    hasMoreOptions?: boolean;
    priceRangeExcluded?: {
        min: number;
        max: number;
    } | null;
}

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
            history,
            userConversation
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
            products: matchingProducts.slice(0, 10),
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
explicitement dans son dernier message. N'utilise les valeurs par défaut que si l'information
n'apparaît nulle part dans la conversation.

Format :
{
  "type_produit": "hoodie/tshirt/veste/polo/short/autre",
  "quantite": nombre (si mentionné, sinon 25 par défaut),
  "budget_par_unite": nombre (si mentionné, sinon 100 par défaut),
  "deadline_jours": nombre de jours (si mentionné, sinon null),
  "sport_ou_activite": "string",
  "autres_besoins": "string",
  "show_all_options": boolean (true si l'utilisateur veut voir TOUTES les options même hors budget)
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
  → {"type_produit":"autre","quantite":25,"budget_par_unite":100,"show_all_options":true}`,
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
        const n = Math.round(Number(value));
        return Number.isFinite(n) && n > 0 && n <= max ? n : undefined;
    };
    const positiveNumber = (value: unknown, max: number): number | undefined => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 && n <= max ? n : undefined;
    };
    const text = (value: unknown): string | undefined =>
        typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : undefined;

    return {
        type_produit: text(raw?.type_produit) ?? 'autre',
        quantite: positiveInt(raw?.quantite, 100000) ?? DEFAULT_QUANTITY,
        budget_par_unite: positiveNumber(raw?.budget_par_unite, 100000) ?? DEFAULT_BUDGET,
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
        WHERE
            "minQty" <= ${quantite}
          AND "maxQty" >= ${quantite}
            ${deadlineCondition}
          AND embedding IS NOT NULL
        ORDER BY similarity DESC
            LIMIT 20
    `;

    if (products.length === 0) {
        const fallbackProducts = await prisma.product.findMany({
            orderBy: { price: 'asc' },
            take: 5,
        });
        return {
            products: fallbackProducts,
            budgetInfo: {
                withinBudgetCount: 0,
                slightlyAboveCount: 0,
                aboveCount: 0,
                totalExcludedCount: 0,
                hasMoreOptions: false,
                priceRangeExcluded: null
            }
        };
    }

    // Classifier les produits par budget
    const withinBudget = products.filter(p => p.price <= budget_par_unite);
    const slightlyAbove = products.filter(p => p.price > budget_par_unite && p.price <= budget_par_unite * 1.3);
    const above = products.filter(p => p.price > budget_par_unite * 1.3);

    // SI L'UTILISATEUR VEUT VOIR TOUTES LES OPTIONS
    if (needs.show_all_options) {
        console.log('🎯 Mode "Afficher tout" activé - Affichage de tous les produits');
        return {
            products: products.slice(0, 10), // Affiche les 10 meilleurs par similarité
            budgetInfo: {
                withinBudgetCount: withinBudget.length,
                slightlyAboveCount: slightlyAbove.length,
                aboveCount: above.length,
                totalExcludedCount: 0, // Aucun exclu car on montre tout
                hasMoreOptions: false,
                priceRangeExcluded: null
            }
        };
    }

    // Sinon, logique normale : afficher seulement ceux dans le budget
    const displayedProducts = withinBudget.slice(0, 3);

    // Calculer les produits exclus (non affichés mais pertinents)
    const excludedProducts = [
        ...withinBudget.slice(3),
        ...slightlyAbove,
        ...above
    ];

    // Calculer le range de prix des produits exclus
    let priceRangeExcluded = null;
    if (excludedProducts.length > 0) {
        const excludedPrices = excludedProducts.map(p => p.price);
        let minPrice = Math.min(...excludedPrices);
        let maxPrice = Math.max(...excludedPrices);

        // S'assurer que min < max
        if (minPrice > maxPrice) {
            [minPrice, maxPrice] = [maxPrice, minPrice];
        }

        priceRangeExcluded = {
            min: Math.round(minPrice),
            max: Math.round(maxPrice)
        };
    }

    return {
        products: displayedProducts.length > 0 ? displayedProducts : products.slice(0, 3),
        budgetInfo: {
            withinBudgetCount: withinBudget.length,
            slightlyAboveCount: slightlyAbove.length,
            aboveCount: above.length,
            totalExcludedCount: excludedProducts.length,
            hasMoreOptions: excludedProducts.length > 0,
            priceRangeExcluded: priceRangeExcluded
        }
    };
}

// Fonction 3 : Générer une recommandation personnalisée avec détection intelligente
async function generateRecommendation(
    originalMessage: string,
    needs: ParsedNeeds,
    products: any[],
    budgetInfo: BudgetInfo,
    history: HistoryMessage[],
    userConversation: string
): Promise<string> {

    // On cherche dans tous les messages du client : un budget donné au premier message
    // ne doit pas être redemandé au troisième.
    const hasQuantity = userConversation.match(/\d+\s*(personnes?|unités?|équipes?|gens|individus?)/i);
    const hasBudget = userConversation.match(/\d+\s*(\$|dollars?|euros?|budget|prix)/i);

    const isDefaultQuantity = needs.quantite === DEFAULT_QUANTITY && !hasQuantity;
    const isDefaultBudget = needs.budget_par_unite === DEFAULT_BUDGET && !hasBudget;

    const missingInfo = [];
    if (isDefaultQuantity) missingInfo.push('le nombre de personnes');
    if (isDefaultBudget) missingInfo.push('votre budget par personne');

    // SI MODE "AFFICHER TOUT" : Générer la réponse directement
    if (needs.show_all_options) {
        const inBudget = products.filter(p => p.price <= needs.budget_par_unite);
        const slightlyAbove = products.filter(p => p.price > needs.budget_par_unite && p.price <= needs.budget_par_unite * 1.3);
        const premium = products.filter(p => p.price > needs.budget_par_unite * 1.3);

        let response = `Bonjour ! Voici toutes les options disponibles qui correspondent à vos besoins :\n\n`;

        // Catégorie 1 : Dans le budget
        if (inBudget.length > 0) {
            response += `📗 **DANS VOTRE BUDGET (≤${needs.budget_par_unite}$)** - ${inBudget.length} option${inBudget.length > 1 ? 's' : ''} :\n`;
            inBudget.forEach(p => {
                response += `• ${p.name} - ${p.price}$ : ${p.description.substring(0, 70)}...\n`;
            });
            response += `\n`;
        }

        // Catégorie 2 : Légèrement au-dessus
        if (slightlyAbove.length > 0) {
            const minPrice = Math.round(needs.budget_par_unite * 1.01);
            const maxPrice = Math.round(needs.budget_par_unite * 1.3);
            response += `📙 **LÉGÈREMENT AU-DESSUS (${minPrice}-${maxPrice}$)** - ${slightlyAbove.length} option${slightlyAbove.length > 1 ? 's' : ''} :\n`;
            slightlyAbove.forEach(p => {
                response += `• ${p.name} - ${p.price}$ : ${p.description.substring(0, 70)}...\n`;
            });
            response += `\n`;
        }

        // Catégorie 3 : Premium
        if (premium.length > 0) {
            const minPremium = Math.round(needs.budget_par_unite * 1.3);
            response += `📕 **OPTIONS PREMIUM (>${minPremium}$)** - ${premium.length} option${premium.length > 1 ? 's' : ''} :\n`;
            premium.forEach(p => {
                response += `• ${p.name} - ${p.price}$ : ${p.description.substring(0, 70)}...\n`;
            });
            response += `\n`;
        }

        // Message de conclusion
        response += `💡 Pour ${needs.quantite} unités, je vous recommande de comparer les options dans votre budget initial de ${needs.budget_par_unite}$. Les options premium offrent des fonctionnalités supplémentaires qui peuvent justifier l'investissement selon vos besoins.\n\n`;
        response += `Souhaitez-vous un devis détaillé pour une option spécifique ?`;

        return response;
    }

    // SINON : Utiliser le LLM pour les cas normaux
    let budgetMessage = '';
    if (hasBudget && budgetInfo.hasMoreOptions && budgetInfo.totalExcludedCount > 0) {
        let priceRange = '';
        if (budgetInfo.priceRangeExcluded) {
            priceRange = `${budgetInfo.priceRangeExcluded.min}$-${budgetInfo.priceRangeExcluded.max}$`;
        } else {
            const minPremiumPrice = Math.round(needs.budget_par_unite * 1.1);
            const maxPremiumPrice = Math.round(needs.budget_par_unite * 1.6);
            priceRange = `${minPremiumPrice}$-${maxPremiumPrice}$`;
        }

        budgetMessage = `
💡 NOTE : Il y a ${budgetInfo.totalExcludedCount} autre${budgetInfo.totalExcludedCount > 1 ? 's' : ''} option${budgetInfo.totalExcludedCount > 1 ? 's' : ''} qui correspond${budgetInfo.totalExcludedCount > 1 ? 'ent' : ''} parfaitement aux besoins mais hors budget (${priceRange}).
Mentionne ceci naturellement à la fin.`;
    }

    const completion = await groq.chat.completions.create({
        messages: [
            {
                role: 'system',
                content: `Tu es un conseiller expert en vêtements d'équipe pour Attraction.

IMPORTANT : Sois CONCIS et NATUREL. Maximum 150 mots.

${missingInfo.length > 0 ? `
🎯 STRATÉGIE HYBRIDE :
L'utilisateur n'a pas précisé : ${missingInfo.join(' et ')}.
Tu DOIS :
1. Montrer quand même 2-3 options (pas de friction !)
2. Demander GENTIMENT et NATURELLEMENT ces informations
3. Ne PAS bloquer la conversation
4. Rester friendly et pas robotique
` : `
✅ Informations complètes reçues.
Fais une recommandation précise et personnalisée.
`}

${budgetMessage}

Structure OBLIGATOIRE :

${missingInfo.length > 0 ? `
1. Accueil chaleureux (1 ligne)
2. Montrer 2-3 options populaires avec prix :
   • [Nom] - [Prix]$ : [Pourquoi c'est bien - 1 phrase]
3. 💡 Question naturelle et amicale pour les infos manquantes
   Exemple : "Pour vous faire une recommandation sur mesure, pourriez-vous me préciser ${missingInfo.join(' et ')} ?"
4. Invitation à continuer (1 ligne)
` : `
1. Accueil + confirmation besoins (2 lignes max)
2. Recommandations ciblées (2-3 produits DANS LE BUDGET) :
   • [Nom] - [Prix]$ : [Pourquoi adapté à LEURS besoins]
3. Total estimé avec LEUR quantité
${budgetInfo.hasMoreOptions ? '4. 💰 Mention NATURELLE des autres options NON AFFICHÉES (hors budget)' : ''}
${budgetInfo.hasMoreOptions ? '5. Question ouverte pour savoir s\'ils veulent les voir' : '4. Prochaine étape'}
`}

Reste NATUREL, FRIENDLY et BREF.
Tiens compte de la conversation précédente : ne répète pas une question déjà posée et ne redemande pas une information déjà donnée.`,
            },
            ...history,
            {
                role: 'user',
                content: `Message du client : "${originalMessage}"

Besoins identifiés :
${JSON.stringify(needs, null, 2)}

Produits affichés (SEULEMENT ceux dans le budget de ${needs.budget_par_unite}$) :
${JSON.stringify(products, null, 2)}

Informations budget :
- Budget demandé : ${needs.budget_par_unite}$/unité
- Produits dans le budget total : ${budgetInfo.withinBudgetCount}
- Produits affichés : ${products.length}
- Produits NON affichés (hors budget) : ${budgetInfo.totalExcludedCount}
${budgetInfo.priceRangeExcluded ? `- Range de prix des produits exclus : ${budgetInfo.priceRangeExcluded.min}$-${budgetInfo.priceRangeExcluded.max}$` : ''}

Informations fournies :
- Quantité : ${hasQuantity ? '✅ Précisée' : '❌ Non précisée (défaut: 25)'}
- Budget : ${hasBudget ? '✅ Précisé' : '❌ Non précisé (défaut: 100$)'}

${budgetInfo.hasMoreOptions ? `⚠️ IMPORTANT : 
- Les ${budgetInfo.totalExcludedCount} produits exclus ne sont PAS dans la liste ci-dessus
- Mentionne-les NATURELLEMENT comme "autres options disponibles"
- Donne le vrai range de prix (${budgetInfo.priceRangeExcluded?.min}$-${budgetInfo.priceRangeExcluded?.max}$)
- Demande s'ils veulent les voir` : ''}

Génère une recommandation ${missingInfo.length > 0 ? 'avec questions amicales' : 'personnalisée et précise'}.`,
            },
        ],
        model: CHAT_MODEL,
        reasoning_effort: 'low',
        temperature: 0.7,
        max_tokens: 1500,
    });

    return completion.choices[0]?.message?.content || 'Désolé, une erreur est survenue.';
}
