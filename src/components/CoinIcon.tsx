/**
 * CoinIcon — single source of truth for the Bulk-Games coin visual.
 *
 * Uses the /assets/Bulk_Coin.png asset via a Vite absolute-path import
 * (same pattern as tableLogo in Poker.tsx).  Vite hashes the filename at
 * build time and embeds the correct URL regardless of deployment path.
 *
 * Replace all inline "(C)" text and 🪙 emoji across the app with this
 * component so the coin logo is consistent and always resolves correctly
 * in production (Railway).
 */

import coinImg from '/assets/Bulk_Coin.png'

interface CoinIconProps {
  /** Pixel size of the icon (width = height).  Defaults to 18. */
  size?: number | string
  /** Extra inline styles merged onto the <img>. */
  style?: React.CSSProperties
  /** Accessible label – defaults to "coins". */
  alt?: string
}

export default function CoinIcon({ size = 18, style, alt = 'coins' }: CoinIconProps) {
  return (
    <img
      src={coinImg}
      alt={alt}
      width={size}
      height={size}
      draggable={false}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        objectFit: 'contain',
        flexShrink: 0,
        ...style,
      }}
    />
  )
}

