import { prisma } from '@/lib/prisma';

async function enableVector() {
    try {
        await prisma.$executeRaw`CREATE EXTENSION IF NOT EXISTS vector;`;
        console.log('✅ Extension vector activée !');
    } catch (error) {
        console.error('❌ Erreur:', error);
    } finally {
        await prisma.$disconnect();
    }
}

enableVector();