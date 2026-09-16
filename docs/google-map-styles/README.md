# ELSET map route shields

These Google cloud style files hide route-number shields while retaining roads, road names and other map features:

- [Light style](light-no-route-shields.json)
- [Dark style](dark-no-route-shields.json)

They are prepared for import into Google Cloud; adding these files to the repository does not change Google's basemap. The app currently falls back to `DEMO_MAP_ID` until a custom ID is configured.

## Connect the styles

1. In the ELSET Google Cloud project, open **Google Maps Platform → Map Styles**. Import each JSON file as its own style and save it. Google publishes newly saved styles; use a new, separate Map ID when preparing a local preview.
2. In **Map Management**, create or choose a **JavaScript** Map ID. Attach the light style to its light-mode slot and the dark style to its dark-mode slot, applying them to Roadmap.
3. Set `VITE_GOOGLE_MAPS_MAP_ID` in the ignored `.env.local` file to that Map ID, then restart Vite. The Map ID is different from the API key.
4. Check route-shield removal in both Elset Classic and Midnight Signal, including zooming and panning. This cloud-side visual check remains pending until the styles are attached to a real Map ID.

For a future authorized production build, supply the same environment variable to `npm run deploy:fly`; the launcher forwards it to the Docker build. No deployment is needed to prepare or review the local code, and no deployment was performed for this change.

Inline `MapOptions.styles` is unsupported when a Map ID is used. The map therefore continues using Advanced Markers and Google's native light/dark schemes, with shield visibility controlled by the attached cloud styles.

References: [Google map options](https://developers.google.com/maps/documentation/javascript/reference/map#MapOptions.styles), [cloud style JSON schema](https://developers.google.com/maps/documentation/javascript/cloud-customization/json-reference), [create and associate styles](https://developers.google.com/maps/documentation/javascript/cloud-customization/map-styles).

## Pin glow

The pin glow mixes its status fill with 20% white and uses a soft 8px blur at 75% opacity. Pin dimensions, 44px touch targets, status colours, selection and overlap cycling are retained.
