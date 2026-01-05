'use client';

import { useState } from 'react';

export default function TestChat() {
    const [message, setMessage] = useState('');
    const [response, setResponse] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    const sendMessage = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message }),
            });
            const data = await res.json();
            setResponse(data);
        } catch (error) {
            console.error(error);
        }
        setLoading(false);
    };

    return (
        <div className="p-8 max-w-4xl mx-auto">
            <h1 className="text-2xl font-bold mb-4">Test API Chat</h1>

            <div className="space-y-4">
        <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Ex: On veut 25 hoodies pour notre équipe de soccer, budget 60$ chacun"
            className="w-full p-4 border rounded-lg h-32"
        />

                <button
                    onClick={sendMessage}
                    disabled={loading}
                    className="bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600 disabled:bg-gray-400"
                >
                    {loading ? 'Envoi...' : 'Envoyer'}
                </button>

                {response && (
                    <div className="mt-6 space-y-4">
                        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                            <h3 className="font-bold mb-2">Réponse IA :</h3>
                            <p className="whitespace-pre-wrap">{response.message}</p>
                        </div>

                        {response.products && response.products.length > 0 && (
                            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                                <h3 className="font-bold mb-2">Produits recommandés :</h3>
                                {response.products.map((p: any) => (
                                    <div key={p.id} className="mb-2 p-2 bg-white rounded">
                                        <p className="font-medium">{p.name}</p>
                                        <p className="text-sm text-gray-600">{p.price}$ - Délai: {p.leadTime} jours</p>
                                    </div>
                                ))}
                            </div>
                        )}

                        <details className="p-4 bg-gray-50 border rounded-lg">
                            <summary className="font-bold cursor-pointer">Debug (besoins détectés)</summary>
                            <pre className="mt-2 text-xs">{JSON.stringify(response.parsedNeeds, null, 2)}</pre>
                        </details>
                    </div>
                )}
            </div>
        </div>
    );
}