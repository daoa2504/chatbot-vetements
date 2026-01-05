import { prisma } from '../lib/prisma';
import { generateEmbedding, productToText } from '../lib/embeddings';

async function embedProducts() {
    console.log('🚀 Début de l\'embedding des produits...');

    const products = await prisma.product.findMany();
    console.log(`📦 ${products.length} produits à traiter`);

    let count = 0;
    for (const product of products) {
        try {
            const text = productToText(product);

            console.log(`Traitement: ${product.name}...`);
            const embedding = await generateEmbedding(text);

            // Utiliser executeRaw pour pgvector
            await prisma.$executeRaw`
        UPDATE "Product"
        SET embedding = ${JSON.stringify(embedding)}::vector
        WHERE id = ${product.id}
      `;

            count++;
            console.log(`✅ ${count}/${products.length} - ${product.name}`);

            // Pause pour ne pas dépasser les limites API
            await new Promise(resolve => setTimeout(resolve, 500));

        } catch (error) {
            console.error(`❌ Erreur pour ${product.name}:`, error);
        }
    }

    console.log(`🎉 Terminé ! ${count} produits embeddés`);
    await prisma.$disconnect();
}

embedProducts();