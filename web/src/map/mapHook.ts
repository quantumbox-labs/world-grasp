// Lets other components reach the Leaflet map that PlanetMap creates (PlanetMap itself stays
// untouched): every new map stores itself on its container element.
import L from 'leaflet';

L.Map.addInitHook(function (this: L.Map) {
  (this.getContainer() as unknown as { __leafletMap?: L.Map }).__leafletMap = this;
});

export const mapOf = (el: Element | null | undefined): L.Map | undefined =>
  (el?.querySelector('.leaflet-container') as unknown as { __leafletMap?: L.Map } | null)?.__leafletMap
  ?? (el as unknown as { __leafletMap?: L.Map } | null)?.__leafletMap;
