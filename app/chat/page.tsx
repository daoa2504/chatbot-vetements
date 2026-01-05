'use client';

import { useState, useRef, useEffect } from 'react';
import AddProductModal from '../components/AddProductModal';

interface Message {
    role: 'user' | 'assistant';
    content: string;
    products?: any[];
}

export default function ChatPage() {
    const [messages, setMessages] = useState<Message[]>([
        {
            role: 'assistant',
            content: "👋 Bonjour ! Je suis votre conseiller en vêtements d'équipe. Décrivez-moi votre projet : type de vêtements, quantité, budget et délai ?"
        }
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // États pour le modal
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const sendMessage = async () => {
        if (!input.trim() || loading) return;

        const userMessage = input.trim();
        setInput('');

        setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
        setLoading(true);

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: userMessage,
                    sessionId: sessionId,
                }),
            });

            const data = await response.json();

            if (data.sessionId) {
                setSessionId(data.sessionId);
            }

            setMessages(prev => [
                ...prev,
                {
                    role: 'assistant',
                    content: data.message,
                    products: data.products,
                },
            ]);
        } catch (error) {
            console.error('Erreur:', error);
            setMessages(prev => [
                ...prev,
                {
                    role: 'assistant',
                    content: "Désolé, une erreur est survenue. Pouvez-vous réessayer ?",
                },
            ]);
        }

        setLoading(false);
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    return (
        <div className="flex flex-col h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
            {/* Header */}
            <div className="bg-white shadow-md p-4 border-b">
                <div className="max-w-4xl mx-auto flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800">
                            🎽 Conseiller IA Vêtements d'Équipe
                        </h1>
                        <p className="text-sm text-gray-600">Powered by Groq AI + RAG pgvector</p>
                    </div>

                    {/* Boutons */}
                    <div className="flex gap-3">
                        <button
                            onClick={() => setIsModalOpen(true)}
                            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                        >
                            ➕ Nouveau produit
                        </button>

                        <button
                            onClick={() => {
                                setMessages([
                                    {
                                        role: 'assistant',
                                        content: "👋 Bonjour ! Je suis votre conseiller en vêtements d'équipe. Décrivez-moi votre projet : type de vêtements, quantité, budget et délai ?"
                                    }
                                ]);
                                setSessionId(null);
                            }}
                            className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                        >
                            🔄 Nouvelle conversation
                        </button>
                    </div>
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4">
                <div className="max-w-4xl mx-auto space-y-4">
                    {messages.map((msg, idx) => (
                        <div
                            key={idx}
                            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                            <div
                                className={`max-w-[80%] rounded-2xl p-4 ${
                                    msg.role === 'user'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-white shadow-md'
                                }`}
                            >
                                <div className="flex items-start gap-3">
                                    {msg.role === 'assistant' && (
                                        <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-xl">
                                            🤖
                                        </div>
                                    )}
                                    <div className="flex-1">
                                        <div className={`whitespace-pre-wrap ${msg.role === 'assistant' ? 'text-gray-800' : 'text-white'}`}>
                                            {msg.content}
                                        </div>

                                        {msg.products && msg.products.length > 0 && (
                                            <div className="mt-4 pt-4 border-t border-gray-200 space-y-2">
                                                <p className="text-sm font-semibold text-gray-700">
                                                    📦 Produits recommandés :
                                                </p>
                                                {msg.products.map((product) => (
                                                    <div
                                                        key={product.id}
                                                        className="bg-gradient-to-r from-blue-50 to-indigo-50 p-3 rounded-lg border border-blue-100"
                                                    >
                                                        <div className="flex justify-between items-start">
                                                            <div className="flex-1">
                                                                <p className="font-medium text-gray-900">
                                                                    {product.name}
                                                                </p>
                                                                <p className="text-sm text-gray-600 mt-1">
                                                                    {product.description}
                                                                </p>
                                                                <div className="flex gap-4 mt-2 text-xs text-gray-600">
                                                                    <span>✓ Min: {product.minQty} unités</span>
                                                                    <span>✓ Délai: {product.leadTime} jours</span>
                                                                    {product.similarity && (
                                                                        <span className="text-blue-600 font-medium">
                                                                            ⭐ Match: {Math.round(product.similarity * 100)}%
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="ml-4 text-right">
                                                                <p className="text-2xl font-bold text-blue-600">
                                                                    {product.price}$
                                                                </p>
                                                                <p className="text-xs text-gray-500">par unité</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}

                    {loading && (
                        <div className="flex justify-start">
                            <div className="bg-white shadow-md rounded-2xl p-4">
                                <div className="flex items-center space-x-2">
                                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                                </div>
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>
            </div>

            {/* Input */}
            <div className="bg-white border-t p-4 shadow-lg">
                <div className="max-w-4xl mx-auto">
                    <div className="flex gap-3">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyPress={handleKeyPress}
                            placeholder="Ex: On veut 25 hoodies pour notre équipe de soccer, budget 60$ par personne..."
                            className="flex-1 p-3 border border-gray-300 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-800 placeholder-gray-400"
                            rows={2}
                            disabled={loading}
                        />
                        <button
                            onClick={sendMessage}
                            disabled={loading || !input.trim()}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-medium transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                        >
                            {loading ? '...' : 'Envoyer'}
                        </button>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                        <p className="text-xs text-gray-600 w-full">Suggestions :</p>
                        {[
                            '25 hoodies soccer, budget 60$',
                            'Vêtements chauds pour l\'hiver, 30 personnes',
                            'T-shirts respirants basketball, 50 personnes',
                        ].map((suggestion, idx) => (
                            <button
                                key={idx}
                                onClick={() => setInput(suggestion)}
                                className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded-full transition-colors"
                            >
                                {suggestion}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Modal d'ajout de produit */}
            <AddProductModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSuccess={() => {
                    setRefreshTrigger(prev => prev + 1);
                }}
            />
        </div>
    );
}