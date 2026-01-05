'use client';

import { useState } from 'react';

export default function AddProductModal({
                                            isOpen,
                                            onClose,
                                            onSuccess,
                                        }: {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [formData, setFormData] = useState({
        name: '',
        type: '',
        price: '',
        minQty: '',
        maxQty: '',
        leadTime: '',
        description: '',
        tags: '',
        customization: '',
        sizes: '',
        colors: '',
        stockQuebec: '',
        stockMontreal: '',
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const productData = {
                name: formData.name,
                type: formData.type,
                price: parseFloat(formData.price),
                minQty: parseInt(formData.minQty),
                maxQty: parseInt(formData.maxQty),
                leadTime: parseInt(formData.leadTime),
                description: formData.description,
                tags: formData.tags.split(',').map(t => t.trim()).filter(Boolean),
                customization: formData.customization,
                sizes: formData.sizes.split(',').map(s => s.trim()).filter(Boolean),
                colors: formData.colors.split(',').map(c => c.trim()).filter(Boolean),
                stockQuebec: parseInt(formData.stockQuebec) || 0,
                stockMontreal: parseInt(formData.stockMontreal) || 0,
            };

            const response = await fetch('/api/products/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(productData),
            });

            const data = await response.json();

            if (data.success) {
                alert(`✅ ${data.message}`);
                onSuccess();
                onClose();
                setFormData({
                    name: '',
                    type: '',
                    price: '',
                    minQty: '',
                    maxQty: '',
                    leadTime: '',
                    description: '',
                    tags: '',
                    customization: '',
                    sizes: '',
                    colors: '',
                    stockQuebec: '',
                    stockMontreal: '',
                });
            } else {
                setError(data.error || 'Erreur lors de la création');
            }
        } catch (err) {
            setError('Erreur de connexion');
        }

        setLoading(false);
    };

    if (!isOpen) return null;

    // Styles inline pour garantir la visibilité
    const inputStyle = {
        backgroundColor: '#ffffff',
        color: '#111827',
        border: '2px solid #d1d5db',
    };

    const labelStyle = {
        color: '#111827',
        fontWeight: '600' as const,
        fontSize: '14px',
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
            onClick={onClose}
        >
            <div
                className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{
                    background: 'linear-gradient(to right, #2563eb, #4f46e5)',
                    padding: '24px',
                    borderTopLeftRadius: '16px',
                    borderTopRightRadius: '16px'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#ffffff' }}>
                            ➕ Ajouter un nouveau produit
                        </h2>
                        <button
                            onClick={onClose}
                            style={{
                                color: '#ffffff',
                                fontSize: '32px',
                                fontWeight: 'bold',
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                width: '32px',
                                height: '32px',
                                lineHeight: '1'
                            }}
                        >
                            ×
                        </button>
                    </div>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} style={{ padding: '24px' }}>
                    {error && (
                        <div style={{
                            backgroundColor: '#fef2f2',
                            border: '2px solid #f87171',
                            color: '#991b1b',
                            padding: '12px 16px',
                            borderRadius: '8px',
                            marginBottom: '16px'
                        }}>
                            ❌ {error}
                        </div>
                    )}

                    {/* Nom du produit */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ ...labelStyle, display: 'block', marginBottom: '8px' }}>
                            Nom du produit *
                        </label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder="Ex: Hoodie Premium Team"
                            required
                            style={{
                                ...inputStyle,
                                width: '100%',
                                padding: '12px',
                                borderRadius: '8px',
                                fontSize: '14px'
                            }}
                        />
                    </div>

                    {/* Type */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ ...labelStyle, display: 'block', marginBottom: '8px' }}>
                            Type *
                        </label>
                        <input
                            type="text"
                            value={formData.type}
                            onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                            placeholder="Ex: hoodie, tshirt, veste, tissu..."
                            required
                            style={{
                                ...inputStyle,
                                width: '100%',
                                padding: '12px',
                                borderRadius: '8px',
                                fontSize: '14px'
                            }}
                        />
                    </div>

                    {/* Prix */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ ...labelStyle, display: 'block', marginBottom: '8px' }}>
                            Prix ($) *
                        </label>
                        <input
                            type="number"
                            step="0.01"
                            value={formData.price}
                            onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                            placeholder="Ex: 55.00"
                            required
                            style={{
                                ...inputStyle,
                                width: '100%',
                                padding: '12px',
                                borderRadius: '8px',
                                fontSize: '14px'
                            }}
                        />
                    </div>

                    {/* Quantités */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                        <div>
                            <label style={{ ...labelStyle, display: 'block', marginBottom: '8px' }}>
                                Qté min *
                            </label>
                            <input
                                type="number"
                                value={formData.minQty}
                                onChange={(e) => setFormData({ ...formData, minQty: e.target.value })}
                                placeholder="Ex: 12"
                                required
                                style={{
                                    ...inputStyle,
                                    width: '100%',
                                    padding: '12px',
                                    borderRadius: '8px',
                                    fontSize: '14px'
                                }}
                            />
                        </div>
                        <div>
                            <label style={{ ...labelStyle, display: 'block', marginBottom: '8px' }}>
                                Qté max *
                            </label>
                            <input
                                type="number"
                                value={formData.maxQty}
                                onChange={(e) => setFormData({ ...formData, maxQty: e.target.value })}
                                placeholder="Ex: 500"
                                required
                                style={{
                                    ...inputStyle,
                                    width: '100%',
                                    padding: '12px',
                                    borderRadius: '8px',
                                    fontSize: '14px'
                                }}
                            />
                        </div>
                    </div>

                    {/* Délai */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ ...labelStyle, display: 'block', marginBottom: '8px' }}>
                            Délai (jours) *
                        </label>
                        <input
                            type="number"
                            value={formData.leadTime}
                            onChange={(e) => setFormData({ ...formData, leadTime: e.target.value })}
                            placeholder="Ex: 10"
                            required
                            style={{
                                ...inputStyle,
                                width: '100%',
                                padding: '12px',
                                borderRadius: '8px',
                                fontSize: '14px'
                            }}
                        />
                    </div>

                    {/* Description */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ ...labelStyle, display: 'block', marginBottom: '8px' }}>
                            Description *
                        </label>
                        <textarea
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            placeholder="Ex: Hoodie en coton biologique avec broderie personnalisée incluse. Parfait pour équipes sportives..."
                            required
                            rows={4}
                            style={{
                                ...inputStyle,
                                width: '100%',
                                padding: '12px',
                                borderRadius: '8px',
                                fontSize: '14px',
                                resize: 'none' as const
                            }}
                        />
                    </div>

                    {/* Tags */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ ...labelStyle, display: 'block', marginBottom: '8px' }}>
                            Tags (séparés par virgules)
                        </label>
                        <input
                            type="text"
                            value={formData.tags}
                            onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                            placeholder="Ex: sport, équipe, hiver, personnalisé"
                            style={{
                                ...inputStyle,
                                width: '100%',
                                padding: '12px',
                                borderRadius: '8px',
                                fontSize: '14px'
                            }}
                        />
                    </div>

                    {/* Personnalisation */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ ...labelStyle, display: 'block', marginBottom: '8px' }}>
                            Options de personnalisation
                        </label>
                        <input
                            type="text"
                            value={formData.customization}
                            onChange={(e) => setFormData({ ...formData, customization: e.target.value })}
                            placeholder="Ex: broderie, sérigraphie, impression numérique"
                            style={{
                                ...inputStyle,
                                width: '100%',
                                padding: '12px',
                                borderRadius: '8px',
                                fontSize: '14px'
                            }}
                        />
                    </div>

                    {/* Tailles et Couleurs */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                        <div>
                            <label style={{ ...labelStyle, display: 'block', marginBottom: '8px' }}>
                                Tailles disponibles
                            </label>
                            <input
                                type="text"
                                value={formData.sizes}
                                onChange={(e) => setFormData({ ...formData, sizes: e.target.value })}
                                placeholder="Ex: S, M, L, XL, XXL"
                                style={{
                                    ...inputStyle,
                                    width: '100%',
                                    padding: '12px',
                                    borderRadius: '8px',
                                    fontSize: '14px'
                                }}
                            />
                        </div>
                        <div>
                            <label style={{ ...labelStyle, display: 'block', marginBottom: '8px' }}>
                                Couleurs disponibles
                            </label>
                            <input
                                type="text"
                                value={formData.colors}
                                onChange={(e) => setFormData({ ...formData, colors: e.target.value })}
                                placeholder="Ex: Noir, Blanc, Rouge, Bleu"
                                style={{
                                    ...inputStyle,
                                    width: '100%',
                                    padding: '12px',
                                    borderRadius: '8px',
                                    fontSize: '14px'
                                }}
                            />
                        </div>
                    </div>

                    {/* Stock */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                        <div>
                            <label style={{ ...labelStyle, display: 'block', marginBottom: '8px' }}>
                                Stock Québec
                            </label>
                            <input
                                type="number"
                                value={formData.stockQuebec}
                                onChange={(e) => setFormData({ ...formData, stockQuebec: e.target.value })}
                                placeholder="Ex: 150"
                                style={{
                                    ...inputStyle,
                                    width: '100%',
                                    padding: '12px',
                                    borderRadius: '8px',
                                    fontSize: '14px'
                                }}
                            />
                        </div>
                        <div>
                            <label style={{ ...labelStyle, display: 'block', marginBottom: '8px' }}>
                                Stock Montréal
                            </label>
                            <input
                                type="number"
                                value={formData.stockMontreal}
                                onChange={(e) => setFormData({ ...formData, stockMontreal: e.target.value })}
                                placeholder="Ex: 200"
                                style={{
                                    ...inputStyle,
                                    width: '100%',
                                    padding: '12px',
                                    borderRadius: '8px',
                                    fontSize: '14px'
                                }}
                            />
                        </div>
                    </div>

                    {/* Boutons */}
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <button
                            type="button"
                            onClick={onClose}
                            style={{
                                flex: 1,
                                padding: '12px 24px',
                                borderRadius: '8px',
                                fontWeight: '600',
                                fontSize: '14px',
                                backgroundColor: '#e5e7eb',
                                color: '#1f2937',
                                border: 'none',
                                cursor: 'pointer'
                            }}
                        >
                            Annuler
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            style={{
                                flex: 1,
                                padding: '12px 24px',
                                borderRadius: '8px',
                                fontWeight: '600',
                                fontSize: '14px',
                                backgroundColor: loading ? '#9ca3af' : '#2563eb',
                                color: '#ffffff',
                                border: 'none',
                                cursor: loading ? 'not-allowed' : 'pointer'
                            }}
                        >
                            {loading ? '⏳ Création...' : '✅ Créer le produit'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}