# AI Apparel Design Studio

Browser-based studio for custom apparel: design a T-shirt, sweatshirt or hoodie, preview it in 360°, see it on a model or on yourself through the camera, generate a logo with AI and order the right size.

**Live demo:** https://www.gilberthroca.com/work/#design

## Features

- **Garment editor:** T-shirt, sweatshirt and hoodie in two colors; multiple logos per garment, front or back; text with 6 fonts; freehand brush; size and position controls.
- **360° and model views:** real model photos (woman, man, girl, boy; age and build options) with the design placed on the garment.
- **Try it on:** live camera or uploaded photo; body tracking (MediaPipe Pose) and clothes segmentation run on the device, so the photo never leaves the browser.
- **AI logo and AI photo:** one serverless function (`_worker.js`, Cloudflare Pages) turns a short description into a logo or a realistic try-on photo with an image model. The API key is a server secret (`GEMINI_API_KEY`), never shipped to the browser; rate-limited to 5 logos per hour.
- **Ordering:** size suggestion from the chosen model's measurements, quantity discounts, delivery-date estimate and cart.
- **English / Spanish** switch.

## Structure

```
index.html        Page markup
css/styles.css    Styles
js/app.js         Editor, 360° view, try-on, AI logo client, pricing and language switch
js/i18n-es.js     Spanish translations
_worker.js        Cloudflare Pages function: /api/tryon (AI photo and AI logo)
```

## Run locally

Static files, no build step:

```
npx serve .
```

The AI features need the function deployed on Cloudflare Pages with the `GEMINI_API_KEY` secret set.

## How it was built

Built by directing AI coding agents (Claude Code) end to end: specification, implementation, browser testing on phone and desktop, and code review.

Author: [Gilberth Roca](https://www.gilberthroca.com)
