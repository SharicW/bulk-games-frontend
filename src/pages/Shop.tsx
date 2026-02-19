import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import { apiGetShopItems, apiBuyItem, apiEquipItem, type ShopItem } from '../services/api'

/** Tiny animated preview for win-celebration effects shown in Shop cards */
function EffectPreview({ effectId }: { effectId: string }) {
  if (effectId === 'effect_red_hearts') {
    return (
      <div className="effect-preview effect-preview--hearts-red">
        {[0, 1, 2, 3, 4].map(i => (
          <span key={i} className="effect-preview__particle" style={{ animationDelay: `${i * 0.22}s` }}>♥</span>
        ))}
      </div>
    )
  }
  if (effectId === 'effect_black_hearts') {
    return (
      <div className="effect-preview effect-preview--hearts-black">
        {[0, 1, 2, 3, 4].map(i => (
          <span key={i} className="effect-preview__particle" style={{ animationDelay: `${i * 0.22}s` }}>♥</span>
        ))}
      </div>
    )
  }
  if (effectId === 'effect_fire_burst') {
    return (
      <div className="effect-preview effect-preview--fire">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <span key={i} className="effect-preview__dot" style={{ animationDelay: `${i * 0.18}s` }} />
        ))}
      </div>
    )
  }
  if (effectId === 'effect_sakura_petals') {
    return (
      <div className="effect-preview effect-preview--sakura">
        {[0, 1, 2, 3, 4].map(i => (
          <span key={i} className="effect-preview__particle" style={{ animationDelay: `${i * 0.25}s` }}>❀</span>
        ))}
      </div>
    )
  }
  if (effectId === 'effect_gold_stars') {
    return (
      <div className="effect-preview effect-preview--gold-stars">
        {[0, 1, 2, 3, 4].map(i => (
          <span key={i} className="effect-preview__particle" style={{ animationDelay: `${i * 0.22}s` }}>★</span>
        ))}
      </div>
    )
  }
  if (effectId === 'effect_rainbow_burst') {
    return (
      <div className="effect-preview effect-preview--rainbow">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <span key={i} className="effect-preview__dot" style={{ animationDelay: `${i * 0.18}s` }} />
        ))}
      </div>
    )
  }
  return null
}

function Shop() {
  const { isLoggedIn, user, loading, refreshUser } = useAuth()
  const [items, setItems] = useState<ShopItem[]>([])
  const [loadingItems, setLoadingItems] = useState(true)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    apiGetShopItems()
      .then(data => setItems(data.items || []))
      .catch(() => setMessage({ text: 'Failed to load shop items', type: 'error' }))
      .finally(() => setLoadingItems(false))
  }, [])

  const handleBuy = useCallback(async (itemId: string) => {
    setBusy(itemId)
    setMessage(null)
    try {
      const res = await apiBuyItem(itemId)
      if (res.success) {
        setMessage({ text: `Purchased! You now have ${res.coins} coins.`, type: 'success' })
        await refreshUser()
      } else {
        setMessage({ text: res.error || 'Purchase failed', type: 'error' })
      }
    } catch {
      setMessage({ text: 'Something went wrong', type: 'error' })
    }
    setBusy(null)
  }, [refreshUser])

  const handleEquip = useCallback(async (itemId: string) => {
    setBusy(itemId)
    setMessage(null)
    try {
      const res = await apiEquipItem(itemId)
      if (res.success) {
        setMessage({ text: 'Equipped!', type: 'success' })
        await refreshUser()
      } else {
        setMessage({ text: res.error || 'Equip failed', type: 'error' })
      }
    } catch {
      setMessage({ text: 'Something went wrong', type: 'error' })
    }
    setBusy(null)
  }, [refreshUser])

  const handleUnequip = useCallback(async (slot: 'border' | 'effect') => {
    setBusy(slot)
    setMessage(null)
    try {
      const res = await apiEquipItem(null, slot)
      if (res.success) {
        setMessage({ text: 'Unequipped!', type: 'success' })
        await refreshUser()
      } else {
        setMessage({ text: res.error || 'Unequip failed', type: 'error' })
      }
    } catch {
      setMessage({ text: 'Something went wrong', type: 'error' })
    }
    setBusy(null)
  }, [refreshUser])

  if (loading) {
    return (
      <div className="page-shell">
        <div className="page-header"><p className="eyebrow">Store</p><h1>Shop</h1></div>
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <div className="spinner" />
          <p className="muted">Loading...</p>
        </div>
      </div>
    )
  }

  if (!isLoggedIn) {
    return (
      <div className="page-shell">
        <div className="page-header"><p className="eyebrow">Store</p><h1>Shop</h1></div>
        <div className="auth-gate-banner">
          <p>You must be logged in to browse the shop.</p>
          <a href="/profile" className="btn-primary" style={{ textDecoration: 'none', width: 'auto', padding: '8px 20px' }}>
            Go to Profile to Login
          </a>
        </div>
      </div>
    )
  }

  const inventory = new Set(user?.inventory ?? [])
  const borders = items.filter(i => i.type === 'border')
  const effects = items.filter(i => i.type === 'effect')

  return (
    <div className="page-shell">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div className="page-header">
          <p className="eyebrow">Store</p>
          <h1>Shop</h1>
        </div>
        <div className="shop-balance">
          <span className="shop-balance__icon">(C)</span>
          <span className="shop-balance__amount">{user?.coins ?? 0} coins</span>
        </div>
      </div>

      {message && (
        <div className={`shop-message shop-message--${message.type}`}>
          {message.text}
        </div>
      )}

      {/* Equipped items */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600 }}>Currently Equipped</h3>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div className="shop-equipped">
            <span className="muted" style={{ fontSize: '12px', textTransform: 'uppercase' }}>Border</span>
            <span style={{ fontWeight: 600 }}>
              {user?.equippedBorder ? items.find(i => i.id === user.equippedBorder)?.name || user.equippedBorder : 'None'}
            </span>
            {user?.equippedBorder && (
              <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: '11px', width: 'auto' }}
                onClick={() => handleUnequip('border')} disabled={busy === 'border'}>
                Unequip
              </button>
            )}
          </div>
          <div className="shop-equipped">
            <span className="muted" style={{ fontSize: '12px', textTransform: 'uppercase' }}>Effect</span>
            <span style={{ fontWeight: 600 }}>
              {user?.equippedEffect ? items.find(i => i.id === user.equippedEffect)?.name || user.equippedEffect : 'None'}
            </span>
            {user?.equippedEffect && (
              <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: '11px', width: 'auto' }}
                onClick={() => handleUnequip('effect')} disabled={busy === 'effect'}>
                Unequip
              </button>
            )}
          </div>
        </div>
      </div>

      {loadingItems ? (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <div className="spinner" />
          <p className="muted">Loading items...</p>
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: '16px' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600 }}>Borders</h3>
            <div className="shop-grid">
              {borders.map(item => {
                const owned = inventory.has(item.id)
                const isEquipped = user?.equippedBorder === item.id || user?.equippedEffect === item.id
                return (
                  <div key={item.id} className={`card shop-item ${owned ? 'shop-item--owned' : ''} ${isEquipped ? 'shop-item--equipped' : ''}`}>
                    <div className={`shop-item__preview ${item.cssClass}`}>
                      <div className="shop-item__avatar-demo">
                        {user?.avatarUrl ? (
                          <img src={user.avatarUrl} alt="" />
                        ) : (
                          <span>👤</span>
                        )}
                      </div>
                    </div>
                    <div className="shop-item__info">
                      <span className="shop-item__name">{item.name}</span>
                      <span className="shop-item__desc muted">{item.description}</span>
                    </div>
                    <div className="shop-item__actions">
                      {!owned ? (
                        <button
                          className="btn-primary"
                          style={{ padding: '8px 14px', fontSize: '13px' }}
                          onClick={() => handleBuy(item.id)}
                          disabled={busy === item.id || (user?.coins ?? 0) < item.price}
                        >
                          {busy === item.id ? 'Buying...' : `Buy - ${item.price} (C)`}
                        </button>
                      ) : isEquipped ? (
                        <span className="shop-item__badge shop-item__badge--equipped">Equipped</span>
                      ) : (
                        <button
                          className="btn-secondary"
                          style={{ padding: '8px 14px', fontSize: '13px' }}
                          onClick={() => handleEquip(item.id)}
                          disabled={busy === item.id}
                        >
                          {busy === item.id ? 'Equipping...' : 'Equip'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="card">
            <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600 }}>Effects</h3>
            <div className="shop-grid">
              {effects.map(item => {
                const owned = inventory.has(item.id)
                const isEquipped = user?.equippedBorder === item.id || user?.equippedEffect === item.id
                return (
                  <div key={item.id} className={`card shop-item ${owned ? 'shop-item--owned' : ''} ${isEquipped ? 'shop-item--equipped' : ''}`}>
                    <div className={`shop-item__preview ${item.cssClass}`}>
                      <div className="shop-item__avatar-demo">
                        {user?.avatarUrl ? (
                          <img src={user.avatarUrl} alt="" />
                        ) : (
                          <span>👤</span>
                        )}
                      </div>
                      <EffectPreview effectId={item.id} />
                    </div>
                    <div className="shop-item__info">
                      <span className="shop-item__name">{item.name}</span>
                      <span className="shop-item__desc muted">{item.description}</span>
                    </div>
                    <div className="shop-item__actions">
                      {!owned ? (
                        <button
                          className="btn-primary"
                          style={{ padding: '8px 14px', fontSize: '13px' }}
                          onClick={() => handleBuy(item.id)}
                          disabled={busy === item.id || (user?.coins ?? 0) < item.price}
                        >
                          {busy === item.id ? 'Buying...' : `Buy - ${item.price} (C)`}
                        </button>
                      ) : isEquipped ? (
                        <span className="shop-item__badge shop-item__badge--equipped">Equipped</span>
                      ) : (
                        <button
                          className="btn-secondary"
                          style={{ padding: '8px 14px', fontSize: '13px' }}
                          onClick={() => handleEquip(item.id)}
                          disabled={busy === item.id}
                        >
                          {busy === item.id ? 'Equipping...' : 'Equip'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default Shop
