/**
 * Génère un embedding avec Jina AI (GRATUIT - 1M requêtes/mois)
 */
export async function generateEmbedding(text: string): Promise<number[]> {
    try {
        const response = await fetch('https://api.jina.ai/v1/embeddings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.JINA_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'jina-embeddings-v3',
                task: 'text-matching',
                dimensions: 1024,
                late_chunking: false,
                embedding_type: 'float',
                input: [text],
            }),
        });

        if (!response.ok) {
            console.error('Erreur Jina:', await response.text());
            return Array(1024).fill(0);
        }

        const data = await response.json();
        return data.data[0].embedding;

    } catch (error) {
        console.error('Erreur génération embedding:', error);
        return Array(1024).fill(0);
    }
}

export function productToText(product: any): string {
    return `
    ${product.name}
    Type: ${product.type}
    ${product.description}
    Tags: ${product.tags.join(', ')}
    Prix: ${product.price}$
    Délai: ${product.leadTime} jours
    Personnalisation: ${product.customization.join(', ')}
  `.trim();
}