import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateEmbedding, productToText } from '@/lib/embeddings';
import { isAdminRequest } from '@/lib/admin-auth';

const MAX_LIST_ITEMS = 30;
const MAX_ITEM_LENGTH = 50;

const parseList = (value: any): string[] => {
    // déjà un tableau -> on renvoie tel quel
    if (Array.isArray(value)) {
        return value.map(v => String(v).trim()).filter(Boolean);
    }

    // null / undefined -> tableau vide
    if (!value) return [];

    // nombre -> converti en string
    if (typeof value === "number") {
        return [String(value)];
    }

    // string classique "a,b,c"
    if (typeof value === "string") {
        return value
            .split(",")
            .map(v => v.trim())
            .filter(Boolean);
    }

    // fallback sécurité
    return [];
};

type ProductInput = {
    name: string;
    type: string;
    price: number;
    minQty: number;
    maxQty: number;
    leadTime: number;
    description: string;
    tags: string[];
    customization: string[];
    sizes: string[];
    colors: string[];
    stockQuebec: number;
    stockMontreal: number;
};

// Valide le corps de la requête champ par champ ; renvoie la liste des erreurs lisibles
function validateProduct(data: any): { product?: ProductInput; errors: string[] } {
    const errors: string[] = [];

    const text = (field: string, label: string, max: number): string => {
        const value = typeof data?.[field] === 'string' ? data[field].trim() : '';
        if (!value) errors.push(`${label} est requis`);
        else if (value.length > max) errors.push(`${label} : ${max} caractères maximum`);
        return value;
    };
    const number = (field: string, label: string, { min, max, integer }: { min: number; max: number; integer: boolean }): number => {
        const value = Number(data?.[field]);
        if (data?.[field] === undefined || data?.[field] === null || data?.[field] === '' || !Number.isFinite(value)) {
            errors.push(`${label} doit être un nombre`);
        } else if (integer && !Number.isInteger(value)) {
            errors.push(`${label} doit être un nombre entier`);
        } else if (value < min || value > max) {
            errors.push(`${label} doit être entre ${min} et ${max}`);
        }
        return value;
    };
    const optionalStock = (field: string, label: string): number => {
        if (data?.[field] === undefined || data?.[field] === null || data?.[field] === '') return 0;
        return number(field, label, { min: 0, max: 1_000_000, integer: true });
    };
    const list = (field: string, label: string): string[] => {
        const items = parseList(data?.[field]);
        if (items.length > MAX_LIST_ITEMS) errors.push(`${label} : ${MAX_LIST_ITEMS} éléments maximum`);
        if (items.some(item => item.length > MAX_ITEM_LENGTH)) errors.push(`${label} : ${MAX_ITEM_LENGTH} caractères maximum par élément`);
        return items;
    };

    const product: ProductInput = {
        name: text('name', 'Le nom', 120),
        type: text('type', 'Le type', 40),
        price: number('price', 'Le prix', { min: 0.01, max: 100_000, integer: false }),
        minQty: number('minQty', 'La quantité minimale', { min: 1, max: 1_000_000, integer: true }),
        maxQty: number('maxQty', 'La quantité maximale', { min: 1, max: 1_000_000, integer: true }),
        leadTime: number('leadTime', 'Le délai', { min: 0, max: 365, integer: true }),
        description: text('description', 'La description', 2000),
        tags: list('tags', 'Les tags'),
        customization: list('customization', 'La personnalisation'),
        sizes: list('sizes', 'Les tailles'),
        colors: list('colors', 'Les couleurs'),
        stockQuebec: optionalStock('stockQuebec', 'Le stock Québec'),
        stockMontreal: optionalStock('stockMontreal', 'Le stock Montréal'),
    };

    if (errors.length === 0 && product.minQty > product.maxQty) {
        errors.push('La quantité minimale ne peut pas dépasser la quantité maximale');
    }

    return errors.length > 0 ? { errors } : { product, errors };
}

export async function POST(request: NextRequest) {
    if (!isAdminRequest(request)) {
        return NextResponse.json(
            { success: false, error: 'Clé admin invalide ou manquante' },
            { status: 401 }
        );
    }

    try {
        let body: unknown;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json(
                { success: false, error: 'Corps de requête JSON invalide' },
                { status: 400 }
            );
        }

        const { product: productData, errors } = validateProduct(body);
        if (!productData) {
            return NextResponse.json(
                { success: false, error: errors.join(' · '), errors },
                { status: 400 }
            );
        }

        console.log('📦 Création du produit:', productData.name);

        // 1. Générer l'embedding AVANT la création : si Jina échoue, generateEmbedding renvoie
        //    un vecteur de zéros, et un produit enregistré avec ce vecteur serait invisible
        //    à la recherche du chatbot.
        const embedding = await generateEmbedding(productToText(productData));
        if (embedding.every(v => v === 0)) {
            return NextResponse.json(
                { success: false, error: 'Service d\'embedding indisponible, réessayez dans un instant' },
                { status: 502 }
            );
        }

        console.log('🧠 Embedding généré, création du produit...');

        // 2. Créer le produit et poser l'embedding dans la même transaction
        const product = await prisma.$transaction(async (tx) => {
            const created = await tx.product.create({ data: productData });
            await tx.$executeRaw`
                UPDATE "Product"
                SET embedding = ${JSON.stringify(embedding)}::vector
                WHERE id = ${created.id}
            `;
            return created;
        });

        console.log('✅ Produit créé avec son embedding !');

        return NextResponse.json({
            success: true,
            product,
            message: `Produit "${product.name}" créé avec succès !`,
        });

    } catch (error) {
        // Le détail reste dans les logs serveur : il peut contenir des informations sur la base
        console.error('❌ Erreur création produit:', error);
        return NextResponse.json(
            { success: false, error: 'Erreur lors de la création du produit' },
            { status: 500 }
        );
    }
}
