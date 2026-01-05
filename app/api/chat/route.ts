import { NextRequest, NextResponse } from 'next/server';
import { groq } from '@/lib/groq';
import { prisma } from '@/lib/prisma';
import { generateEmbedding } from '@/lib/embeddings';

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
        const parsedNeeds = await parseUserNeeds(message);

        // Étape 2 : Chercher les produits correspondants (avec RAG vectoriel)
        const matchingProducts = await findMatchingProducts(parsedNeeds);

        // Étape 3 : Générer une réponse personnalisée
        const aiResponse = await generateRecommendation(
            message,
            parsedNeeds,
            matchingProducts
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
            products: matchingProducts.slice(0, 3), // Top 3 produits
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
async function parseUserNeeds(message: string): Promise<ParsedNeeds> {
    const completion = await groq.chat.completions.create({
        messages: [
            {
                role: 'system',
                content: `Tu es un expert en extraction d'informations pour vêtements d'équipe.
Extrait les besoins du client et réponds UNIQUEMENT en JSON valide (sans markdown, sans backticks) :
{
  "type_produit": "hoodie/tshirt/veste/polo/short/autre",
  "quantite": nombre (si mentionné, sinon 25 par défaut),
  "budget_par_unite": nombre (si mentionné, sinon 100 par défaut),
  "deadline_jours": nombre de jours (si mentionné, sinon null),
  "sport_ou_activite": "string",
  "autres_besoins": "string"
}

Exemples:
- "On veut 25 hoodies pour notre équipe de soccer, budget 60$ chacun" 
  → {"type_produit":"hoodie","quantite":25,"budget_par_unite":60,"sport_ou_activite":"soccer"}
  
- "T-shirts pour 50 personnes, livraison avant 2 semaines"
  → {"type_produit":"tshirt","quantite":50,"budget_par_unite":100,"deadline_jours":14}`,
            },
            {
                role: 'user',
                content: message,
            },
        ],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.2,
        max_tokens: 500,
    });

    const text = completion.choices[0]?.message?.content || '{}';
    const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    try {
        return JSON.parse(cleanText);
    } catch (e) {
        console.error('Erreur parsing besoins:', text);
        return {
            type_produit: 'autre',
            quantite: 25,
            budget_par_unite: 100,
        };
    }
}

// Fonction 2 : Chercher les produits avec RAG vectoriel (pgvector)
async function findMatchingProducts(needs: ParsedNeeds) {
    const { type_produit, quantite, budget_par_unite, deadline_jours, autres_besoins } = needs;

    const searchQuery = `
    ${type_produit} 
    ${needs.sport_ou_activite || ''} 
    ${autres_besoins || ''}
    budget ${budget_par_unite}$
    quantité ${quantite}
  `.trim();

    // Générer l'embedding de la requête
    const queryEmbedding = await generateEmbedding(searchQuery);

    // Construire la clause WHERE pour deadline
    const deadlineCondition = deadline_jours
        ? `AND "leadTime" <= ${deadline_jours}`
        : '';

    // Recherche vectorielle avec pgvector
    const products = await prisma.$queryRawUnsafe(`
    SELECT 
      id, name, type, price, "minQty", "maxQty", "leadTime",
      description, tags, customization, sizes, colors,
      "stockQuebec", "stockMontreal",
      1 - (embedding <=> '${JSON.stringify(queryEmbedding)}'::vector) as similarity
    FROM "Product"
    WHERE 
      price <= ${budget_par_unite * 1.2}
      AND "minQty" <= ${quantite}
      AND "maxQty" >= ${quantite}
      ${deadlineCondition}
      AND embedding IS NOT NULL
    ORDER BY similarity DESC, price ASC
    LIMIT 5
  `) as any[];

    // Si aucun résultat, élargir la recherche
    if (products.length === 0) {
        return await prisma.product.findMany({
            where: {
                price: { lte: budget_par_unite * 1.5 },
            },
            orderBy: { price: 'asc' },
            take: 3,
        });
    }

    return products;
}
// Fonction 3 : Générer une recommandation personnalisée avec détection intelligente
async function generateRecommendation(
    originalMessage: string,
    needs: ParsedNeeds,
    products: any[]
): Promise<string> {

    const hasQuantity = originalMessage.match(/\d+\s*(personnes?|unités?|équipes?|gens|individus?)/i);
    const hasBudget = originalMessage.match(/\d+\s*(\$|dollars?|euros?|budget|prix)/i);

    // Si quantité n'est pas explicite, vérifier si c'est le défaut (25)
    const isDefaultQuantity = needs.quantite === 25 && !hasQuantity;
    const isDefaultBudget = needs.budget_par_unite === 100 && !hasBudget;

    const missingInfo = [];
    if (isDefaultQuantity) missingInfo.push('le nombre de personnes');
    if (isDefaultBudget) missingInfo.push('votre budget par personne');

    const completion = await groq.chat.completions.create({
        messages: [
            {
                role: 'system',
                content: `Tu es un conseiller expert en vêtements d'équipe pour Attraction.

IMPORTANT : Sois CONCIS et NATUREL. Maximum 150 mots.

${missingInfo.length > 0 ? `
🎯 STRATÉGIE HYBRIDE ACTIVÉE :
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
2. Recommandations ciblées (2-3 produits) :
   • [Nom] - [Prix]$ : [Pourquoi adapté à LEURS besoins]
3. Total estimé avec LEUR quantité
4. Prochaine étape
`}

EXEMPLES :

${missingInfo.length > 0 ? `
Exemple SANS budget ni quantité :
"Bonjour ! Nous avons d'excellents hoodies pour équipes.

Voici nos options populaires :
- Hoodie Économique - 38$ : Parfait rapport qualité-prix, livraison rapide
- Hoodie Premium - 55$ : Coton bio avec broderie incluse

💡 Pour une recommandation personnalisée, pourriez-vous me préciser le nombre de personnes et votre budget approximatif par personne ?

Je peux aussi vous montrer d'autres options si vous voulez !"
` : `
Exemple AVEC toutes les infos :
"Bonjour ! Parfait pour une équipe de 25 avec un budget de 60$/personne.

Mes recommandations :
- Hoodie Économique - 38$ : Économisez 22$/unité, qualité excellente
- Hoodie Premium - 55$ : Dans votre budget, look professionnel premium

Pour 25 unités en Hoodie Premium : 1375$ + taxes
Délai : 10 jours

Souhaitez-vous un devis détaillé ?"
`}

Reste NATUREL, FRIENDLY et BREF.`,
            },
            {
                role: 'user',
                content: `Message du client : "${originalMessage}"

Besoins identifiés :
${JSON.stringify(needs, null, 2)}

Produits disponibles (recommande les 2-3 meilleurs) :
${JSON.stringify(products.slice(0, 3), null, 2)}

Informations fournies :
- Quantité : ${hasQuantity ? '✅ Précisée' : '❌ Non précisée (défaut: 25)'}
- Budget : ${hasBudget ? '✅ Précisé' : '❌ Non précisé (défaut: 100$)'}

Génère une recommandation ${missingInfo.length > 0 ? 'avec questions amicales' : 'personnalisée et précise'}.`,
            },
        ],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.7,
        max_tokens: 500,
    });

    return completion.choices[0]?.message?.content || 'Désolé, une erreur est survenue.';
}
