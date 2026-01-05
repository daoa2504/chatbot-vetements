import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateEmbedding, productToText } from '@/lib/embeddings';

export async function POST(request: NextRequest) {
    try {
        const productData = await request.json();

        console.log('📦 Création du produit:', productData.name);

        // 1. Créer le produit (sans embedding pour l'instant)
        const product = await prisma.product.create({
            data: {
                name: productData.name,
                type: productData.type,
                price: parseFloat(productData.price),
                minQty: parseInt(productData.minQty),
                maxQty: parseInt(productData.maxQty),
                leadTime: parseInt(productData.leadTime),
                description: productData.description,
                tags: productData.tags || [],
                customization: productData.customization || [],
                sizes: productData.sizes || [],
                colors: productData.colors || [],
                stockQuebec: parseInt(productData.stockQuebec) || 0,
                stockMontreal: parseInt(productData.stockMontreal) || 0,
            },
        });

        console.log('✅ Produit créé, génération de l\'embedding...');

        // 2. Générer l'embedding
        const text = productToText(product);
        const embedding = await generateEmbedding(text);

        console.log('🧠 Embedding généré, sauvegarde...');

        // 3. Mettre à jour avec l'embedding
        await prisma.$executeRaw`
      UPDATE "Product"
      SET embedding = ${JSON.stringify(embedding)}::vector
      WHERE id = ${product.id}
    `;

        console.log('✅ Embedding sauvegardé !');

        // 4. Récupérer le produit complet
        const updatedProduct = await prisma.product.findUnique({
            where: { id: product.id },
        });

        return NextResponse.json({
            success: true,
            product: updatedProduct,
            message: `Produit "${product.name}" créé avec succès !`,
        });

    } catch (error: any) {
        console.error('❌ Erreur création produit:', error);
        return NextResponse.json(
            {
                success: false,
                error: 'Erreur lors de la création du produit',
                details: error.message
            },
            { status: 500 }
        );
    }
}