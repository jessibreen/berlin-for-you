# Berlin for You ♥ — Location-Aware Travel Map

A personal map for a trip to Berlin. Opens in any mobile browser, tracks location via GPS, and sends proximity alerts when the user approaches saved places.

---

## Repo structure

```
berlin-map/
├── index.html          ← The map (served via GitHub Pages)
├── data/
│   └── pois.geojson    ← All points of interest
├── images/
│   └── *.jpg / *.png   ← Photos referenced from pois.geojson
└── README.md
```

---

## Setting up GitHub Pages

1. Push this repo to GitHub
2. Go to **Settings → Pages**
3. Set source to **Deploy from branch → main → / (root)**
4. Your map will be live at `https://yourusername.github.io/your-repo-name/`

---

## Adding / editing POIs

Edit `data/pois.geojson`. Each feature looks like this:

```json
{
  "type": "Feature",
  "geometry": {
    "type": "Point",
    "coordinates": [13.3777, 52.5163]
  },
  "properties": {
    "name": "Brandenburg Gate",
    "address": "Pariser Platz, 10117 Berlin",
    "category": "landmark",
    "note": "Go at golden hour — the light through the columns is incredible.",
    "photos": ["images/brandenburg.jpg"],
    "radius": 250
  }
}
```

### Properties reference

| Property   | Required | Description |
|------------|----------|-------------|
| `name`     | ✅       | Display name |
| `address`  | optional | Street address shown in popup |
| `category` | ✅       | Controls icon, colour, and default alert radius |
| `note`     | optional | Your personal message — shown in the popup and alert |
| `photos`   | optional | Array of image paths (relative to repo root) or full URLs |
| `radius`   | optional | Alert radius in metres — overrides the category default |

### Available categories (and their default radii)

| Category       | Default radius | Emoji |
|----------------|---------------|-------|
| `landmark`     | 200m          | 🏛    |
| `building`     | 180m          | 🏢    |
| `museum`       | 150m          | 🖼    |
| `neighborhood`| 120m          | 🏘    |
| `cafe`         | 80m           | ☕    |
| `restaurant`   | 80m           | 🍽    |
| `bar`          | 70m           | 🍸    |
| `shop`         | 60m           | 🛍    |
| `park`         | 150m          | 🌿    |
| `artwork`      | 40m           | 🎨    |
| `other`        | 100m          | 📍    |

You can add new categories by editing the `CONFIG.categoryDefaults` and `CONFIG.categoryStyle` objects near the top of `index.html`.

---

## Adding photos

1. Place image files in the `images/` folder
2. Reference them in the GeoJSON like: `"photos": ["images/my-photo.jpg"]`
3. Multiple photos are supported: `"photos": ["images/a.jpg", "images/b.jpg"]`
4. External URLs also work: `"photos": ["https://example.com/photo.jpg"]`

Keep images reasonably compressed (under ~300KB each) to be kind to mobile data.

---

## Pulling POIs from OpenStreetMap

Use [Overpass Turbo](https://overpass-turbo.eu/) to query OSM and export as GeoJSON.

Example query for cafés in Berlin:
```
[out:json][timeout:25];
area["name"="Berlin"]->.searchArea;
node["amenity"="cafe"](area.searchArea);
out body;
```

Export → Download as GeoJSON, then manually add `note`, `photos`, and any custom `radius` fields to the features you want to keep.

---

## How alerts work

- The map fetches `data/pois.geojson` fresh on each page load — so any edits you push to GitHub will be live next time the user refreshes
- Location is tracked via the browser's Geolocation API (GPS on Android)
- When the user enters the radius of a POI, they get a push notification, a vibration, and the map flies to that spot
- For push notifications to work, the user must grant notification permission when prompted
- **Tip:** Add the page to your home screen via Chrome → "Add to Home Screen" for the best experience

---

## Updating the map

Just edit `pois.geojson` and push to GitHub. The user refreshes the page and sees your changes instantly. No app update required.
