import { useEffect } from 'react';
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import type { ReportCoordinates } from '@/domain/types';

const TIVAT_CENTER: [number, number] = [42.4319, 18.7112];
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

function MapClick({ onPick }: { onPick: (coordinates: ReportCoordinates) => void }) {
  useMapEvents({
    click(event) {
      onPick({
        latitude: event.latlng.lat,
        longitude: event.latlng.lng,
        accuracyMeters: null,
        source: 'MAP_PIN',
        capturedAt: new Date().toISOString(),
      });
    },
  });
  return null;
}

function FollowSelection({ coordinates }: { coordinates: ReportCoordinates | null }) {
  const map = useMap();
  useEffect(() => {
    if (coordinates) map.panTo([coordinates.latitude, coordinates.longitude]);
  }, [coordinates, map]);
  return null;
}

export function IncidentMapPicker({
  coordinates,
  onPick,
}: {
  coordinates: ReportCoordinates | null;
  onPick: (coordinates: ReportCoordinates) => void;
}) {
  return (
    <div className="incident-map" data-testid="incident-map-picker">
      <MapContainer
        center={coordinates ? [coordinates.latitude, coordinates.longitude] : TIVAT_CENTER}
        zoom={13}
        scrollWheelZoom={false}
        aria-label="Mapa za oznacavanje mjesta dogadjaja"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> saradnici'
          url={TILE_URL}
        />
        <MapClick onPick={onPick} />
        <FollowSelection coordinates={coordinates} />
        {coordinates ? (
          <CircleMarker
            center={[coordinates.latitude, coordinates.longitude]}
            radius={11}
            pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#d52b2b', fillOpacity: 1 }}
          >
            <Popup>Oznaceno mjesto dogadjaja</Popup>
          </CircleMarker>
        ) : null}
      </MapContainer>
      <p className="incident-map__caption">
        Dodirnite ili kliknite mapu da postavite oznaku. GPS uredjaja i rucna oznaka nijesu
        isto: prije slanja provjerite da oznaka pokazuje mjesto dogadjaja.
      </p>
    </div>
  );
}

export function ReportMap({
  reports,
}: {
  reports: readonly {
    id: string;
    coordinates: ReportCoordinates | null;
    label: string;
    reviewed: boolean;
  }[];
}) {
  const mapped = reports.filter(
    (report): report is typeof report & { coordinates: ReportCoordinates } => report.coordinates !== null,
  );

  return (
    <div className="incident-map incident-map--overview" data-testid="report-map">
      <MapContainer center={TIVAT_CENTER} zoom={12} scrollWheelZoom={false} aria-label="Mapa probnih prijava">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> saradnici'
          url={TILE_URL}
        />
        {mapped.map((report) => (
          <CircleMarker
            key={report.id}
            center={[report.coordinates.latitude, report.coordinates.longitude]}
            radius={9}
            pathOptions={{
              color: '#ffffff',
              weight: 2,
              fillColor: report.reviewed ? '#1b7f5d' : '#e58b21',
              fillOpacity: 1,
            }}
          >
            <Popup>{report.reviewed ? 'Pregledana probna prijava' : 'Neprovjerena probna prijava'}: {report.label}</Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      <div className="map-legend" aria-label="Legenda mape">
        <span><i data-tone="unverified" /> Neprovjerena prijava</span>
        <span><i data-tone="reviewed" /> Pregledana prijava</span>
      </div>
    </div>
  );
}
