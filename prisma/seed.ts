import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Début du seed...');

    // Nettoyer les données existantes
    await prisma.chatMessage.deleteMany();
    await prisma.chatSession.deleteMany();
    await prisma.product.deleteMany();

    // Créer des produits
    const products = await prisma.product.createMany({
        data: [
            {
                name: 'Hoodie Premium Team',
                type: 'hoodie',
                price: 55,
                minQty: 12,
                maxQty: 500,
                leadTime: 10,
                description: 'Hoodie en coton biologique avec broderie personnalisée incluse. Parfait pour équipes sportives et universitaires. Coupe confortable et durable.',
                tags: ['sport', 'équipe', 'soccer', 'université', 'extérieur', 'confortable'],
                customization: ['broderie', 'sérigraphie', 'patch'],
                sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
                colors: ['Noir', 'Blanc', 'Gris', 'Marine', 'Rouge'],
                stockQuebec: 200,
                stockMontreal: 150,
            },
            {
                name: 'Hoodie Économique',
                type: 'hoodie',
                price: 38,
                minQty: 20,
                maxQty: 1000,
                leadTime: 7,
                description: 'Hoodie classique avec sérigraphie. Excellent rapport qualité-prix pour grands volumes.',
                tags: ['sport', 'équipe', 'économique', 'volume'],
                customization: ['sérigraphie'],
                sizes: ['S', 'M', 'L', 'XL', 'XXL'],
                colors: ['Noir', 'Gris', 'Marine'],
                stockQuebec: 500,
                stockMontreal: 400,
            },
            {
                name: 'T-shirt Performance Dry-Fit',
                type: 'tshirt',
                price: 25,
                minQty: 20,
                maxQty: 1000,
                leadTime: 5,
                description: 'T-shirt technique respirant avec sérigraphie haute qualité. Idéal pour sports et événements. Évacuation rapide de la transpiration.',
                tags: ['sport', 'équipe', 'soccer', 'basketball', 'respirant', 'performance'],
                customization: ['sérigraphie', 'sublimation'],
                sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'],
                colors: ['Noir', 'Blanc', 'Bleu royal', 'Rouge', 'Vert', 'Jaune'],
                stockQuebec: 500,
                stockMontreal: 300,
            },
            {
                name: 'T-shirt Coton Classique',
                type: 'tshirt',
                price: 18,
                minQty: 30,
                maxQty: 2000,
                leadTime: 5,
                description: 'T-shirt 100% coton avec sérigraphie. Le choix économique pour grands événements.',
                tags: ['sport', 'équipe', 'événement', 'économique', 'casual'],
                customization: ['sérigraphie'],
                sizes: ['S', 'M', 'L', 'XL', 'XXL'],
                colors: ['Noir', 'Blanc', 'Gris', 'Rouge', 'Bleu'],
                stockQuebec: 800,
                stockMontreal: 600,
            },
            {
                name: 'Veste Softshell Team Elite',
                type: 'veste',
                price: 75,
                minQty: 10,
                maxQty: 200,
                leadTime: 15,
                description: 'Veste coupe-vent imperméable avec broderie logo. Parfaite pour entraînements extérieurs et saison froide.',
                tags: ['sport', 'équipe', 'extérieur', 'imperméable', 'hiver'],
                customization: ['broderie'],
                sizes: ['S', 'M', 'L', 'XL', 'XXL'],
                colors: ['Noir', 'Gris foncé', 'Marine'],
                stockQuebec: 80,
                stockMontreal: 60,
            },
            {
                name: 'Polo Sport Performance',
                type: 'polo',
                price: 42,
                minQty: 15,
                maxQty: 500,
                leadTime: 8,
                description: 'Polo technique avec broderie. Idéal pour équipes corporatives et clubs sportifs.',
                tags: ['sport', 'équipe', 'corporate', 'golf', 'tennis'],
                customization: ['broderie', 'sérigraphie'],
                sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
                colors: ['Noir', 'Blanc', 'Marine', 'Rouge', 'Vert'],
                stockQuebec: 150,
                stockMontreal: 100,
            },
            {
                name: 'Short Sport Respirant',
                type: 'short',
                price: 28,
                minQty: 20,
                maxQty: 500,
                leadTime: 7,
                description: 'Short technique avec sérigraphie. Tissu léger et respirant pour performance optimale.',
                tags: ['sport', 'équipe', 'soccer', 'basketball', 'course', 'été'],
                customization: ['sérigraphie'],
                sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
                colors: ['Noir', 'Marine', 'Rouge', 'Blanc'],
                stockQuebec: 200,
                stockMontreal: 150,
            },
            {
                name: 'Casquette Brodée',
                type: 'accessoire',
                price: 22,
                minQty: 24,
                maxQty: 1000,
                leadTime: 5,
                description: 'Casquette ajustable avec broderie logo. Complément parfait pour uniformes d\'équipe.',
                tags: ['sport', 'équipe', 'accessoire', 'baseball', 'casual'],
                customization: ['broderie'],
                sizes: ['Unique'],
                colors: ['Noir', 'Marine', 'Rouge', 'Blanc', 'Gris'],
                stockQuebec: 300,
                stockMontreal: 250,
            },
            {
                name: 'Veste Bomber Personnalisée',
                type: 'veste',
                price: 95,
                minQty: 8,
                maxQty: 150,
                leadTime: 20,
                description: 'Veste bomber premium avec broderie complexe. Look professionnel pour équipes élites.',
                tags: ['sport', 'équipe', 'premium', 'hiver', 'style'],
                customization: ['broderie', 'patch'],
                sizes: ['S', 'M', 'L', 'XL', 'XXL'],
                colors: ['Noir', 'Marine', 'Bordeaux'],
                stockQuebec: 40,
                stockMontreal: 30,
            },
            {
                name: 'Débardeur Performance',
                type: 'debardeur',
                price: 20,
                minQty: 20,
                maxQty: 500,
                leadTime: 5,
                description: 'Débardeur technique respirant. Parfait pour basketball et sports intérieurs.',
                tags: ['sport', 'équipe', 'basketball', 'volleyball', 'été'],
                customization: ['sérigraphie', 'sublimation'],
                sizes: ['S', 'M', 'L', 'XL', 'XXL'],
                colors: ['Noir', 'Blanc', 'Bleu', 'Rouge', 'Jaune'],
                stockQuebec: 250,
                stockMontreal: 200,
            },
        ],
    });

    console.log(`✅ ${products.count} produits créés`);
    console.log('🎉 Seed terminé avec succès !');
}

main()
    .catch((e) => {
        console.error('❌ Erreur lors du seed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });