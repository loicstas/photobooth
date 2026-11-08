# photobooth

## Foto's van TouchDesigner naar de website

Dit project verzorgt de volledige flow van foto nemen tot foto downloaden: van TouchDesigner via een back-end naar een website waar bezoekers hun foto's kunnen ophalen.

## Overzicht

```
TouchDesigner → Back-end ─┬→ Lokale opslag (altijd)
                          └→ MongoDB (wanneer bereikbaar)
                               ↓
                           Front-end ← QR-code op ticket
```

## Hoe werkt het?

1. **Foto nemen**
   Wanneer in TouchDesigner een foto wordt genomen, wordt die automatisch naar de back-end gestuurd.

2. **Opslag**
   De back-end slaat elke foto **altijd lokaal** op, ook als MongoDB werkt. Daarnaast wordt de foto opgeslagen in **MongoDB**.
   Als er geen verbinding is met MongoDB, blijft de lokale kopie beschikbaar. Zo blijft het systeem werken, ook als er iets misgaat.

3. **Weergave**
   De front-end toont de foto's en laat bezoekers ze downloaden. Als MongoDB niet bereikbaar is, worden de foto's uit de lokale opslag gehaald.

4. **Toegang via ticket**
   Elk ticket bevat een **QR-code**. Door die te scannen, komt de bezoeker op de website, waar hij of zij de foto's kan bekijken en downloaden.

## Foutafhandeling

| Situatie | Gedrag |
|---|---|
| MongoDB bereikbaar | Foto wordt lokaal én in MongoDB opgeslagen |
| MongoDB niet bereikbaar | Foto wordt enkel lokaal opgeslagen, de front-end gebruikt