# EliteBot homepage artwork

The homepage pairs the existing headline and working account links with an original transparent image of a man presenting a phone with an MT5 demo chart. The headline remains selectable HTML, with one semantic H1. The headline and artwork sit side by side on desktop and mobile. Below 761px, the supporting description, account links, and proof use the available width below that pair, keeping the text readable and touch targets at least 48px tall. The existing platform, workflow, pricing, and security content remains below the hero.

## Assets

- `public/assets/hero-mt5-hd.webp`: 1254 × 1254 pixels, transparent HD source for larger screens.
- `public/assets/hero-mt5-640.webp`: 640 × 640 pixels, transparent mobile version.

Both versions retain the generated alpha channel. `srcset`, intrinsic dimensions, and high fetch priority keep the image sharp, avoid layout shift, and reduce mobile transfer size. The same artwork works in light and dark themes. The screen and caption explicitly identify illustrative demo data.

Generation mode: built-in image generation, followed by WebP packaging and responsive sizing. The original PNG is retained in the generation output.

Verified at 320, 390, 768, 1024, 1440, and 1920px in both themes: no horizontal overflow or overlapping columns. The homepage reflows at 200% text size. Both image routes serve WebP successfully; account and platform links work; the hero has no axe WCAG A/AA violations or browser script errors. Browser verification uses an isolated local database and does not create production accounts or perform trading actions.

## Final generation prompt

```text
Use case: ads-marketing
Asset type: high-definition graphical hero artwork for the EliteBot trading website, to sit on the right of a large live HTML headline. Generate the artwork only, without webpage text.
Primary request: a premium editorial illustration representing an adult man holding a smartphone that visibly shows MetaTrader 5 trading.
Subject: one adult man around 30, warm medium-brown skin, short neatly styled dark hair, clean minimal dark navy crewneck. Relaxed, self-assured expression with a subtle smile. Waist-up three-quarter portrait. He holds one modern smartphone upright toward the viewer in a natural anatomically correct hand, with the screen unobstructed and clearly facing the camera. The phone is in the nearer foreground and large enough that its trading interface is a strong focal point; the man is behind it. Both the whole phone and the man's head must fit in frame.
Phone display: a sharp dark MetaTrader 5 mobile interface, a blue top label reading exactly "MetaTrader 5", chart heading "XAUUSD · M15", small "DEMO" label, clear blue and red candlesticks on a graphite grid, thin price scale and bottom tabs. Treat the chart as illustrative demonstration data, with no profit, balance, performance, or success claims. Prioritize clean chart rendering over tiny numbers.
Style/medium: sophisticated high-end 3D editorial illustration with realistic facial proportions, lifelike soft skin shading, finely detailed fabric, brushed metal smartphone rim and restrained cinematic polish. Memorable graphic product artwork, not a generic stock lifestyle photograph.
Composition/framing: square 2048 by 2048 high-definition composition. Subject centered with comfortable transparent margin all around; show down to the waist, no cropped head or hands. Phone on the viewer's left of the man, so it visually meets the text beside the artwork when placed on the right of the page.
Lighting/mood: large soft studio light from upper left, neutral warm highlights, very subtle cool blue rim light; calm, precise, premium.
Scene/backdrop: genuinely transparent background. Only the man and phone, with clean alpha edges. No backdrop rectangle, floor, scenery, graphic cards, additional devices or people.
Constraints: correct hands and fingers; fully visible sharp phone screen; no floating charts, money, coins, trophies, watermarks, extra slogans or logos. No headline or CTA baked into the artwork.
```
