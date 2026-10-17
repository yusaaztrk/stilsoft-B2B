import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

export type MapTechnician = {
  id: string;
  fullName: string;
  phone: string;
  status: string;
  statusText: string;
  latitude: number;
  longitude: number;
  isOnline?: boolean;
};

interface MapViewerProps {
  technicians: MapTechnician[];
  style?: ViewStyle;
}

export default function MapViewer({ technicians, style }: MapViewerProps) {
  const webViewRef = useRef<WebView>(null);

  // Generate initial HTML
  const generateHTML = () => {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
        <style>
          html, body, #map {
            height: 100%;
            margin: 0;
            padding: 0;
            background-color: #0c0c0c;
          }
          /* Custom Dark Mode styling for popup */
          .leaflet-popup-content-wrapper {
            background: #18181b !important;
            color: #f4f4f5 !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            border-radius: 12px !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5) !important;
          }
          .leaflet-popup-tip {
            background: #18181b !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
          }
          .popup-title {
            font-weight: 800;
            font-size: 14px;
            color: #ffffff;
            margin-bottom: 4px;
          }
          .popup-info {
            font-size: 12px;
            color: #a1a1aa;
            margin-bottom: 2px;
          }
          .popup-status {
            display: inline-block;
            margin-top: 6px;
            font-size: 10px;
            font-weight: 800;
            text-transform: uppercase;
            padding: 2px 6px;
            border-radius: 4px;
          }
          
          /* Custom DivIcon Tech Marker Styles */
          .custom-tech-div-icon {
            background: none !important;
            border: none !important;
          }
          .tech-marker-wrapper {
            position: relative;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #ffffff;
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 11px;
            font-weight: 800;
            box-shadow: 0 3px 8px rgba(0, 0, 0, 0.5);
            border: 2px solid #ffffff;
            transition: all 0.3s ease;
          }
          
          /* Pulse Animations for Online status */
          .pulse-active::after {
            content: '';
            position: absolute;
            width: 100%;
            height: 100%;
            border-radius: 50%;
            top: -2px;
            left: -2px;
            border: 2px solid inherit;
            opacity: 0.8;
            animation: markerPulse 2s infinite;
            z-index: -1;
          }
          
          @keyframes markerPulse {
            0% { transform: scale(1); opacity: 0.8; }
            100% { transform: scale(1.8); opacity: 0; }
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          // Initialize map with full world bounds
          var map = L.map('map', { 
            zoomControl: false,
            minZoom: 2,
            worldCopyJump: true
          }).setView([39.92077, 32.85411], 6);

          L.control.zoom({ position: 'topleft' }).addTo(map);

          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 18,
            minZoom: 2,
            attribution: '© OpenStreetMap contributors'
          }).addTo(map);

          var markers = {};

          function getInitials(fullName) {
            if (!fullName) return '--';
            var parts = fullName.trim().split(' ');
            if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
          }

          function createTechIcon(t) {
            var color = '#6b7280'; // Default Gray for Offline (OffDuty)
            var pulseStyle = '';
            var initials = getInitials(t.fullName);

            if (t.isOnline) {
              if (t.status === 'OnField') {
                color = '#3b82f6'; // Blue for OnField
                pulseStyle = 'pulse-active';
              } else if (t.status === 'OnBreak') {
                color = '#f59e0b'; // Amber for OnBreak
                pulseStyle = 'pulse-active';
              } else {
                color = '#10b981'; // Green for Online/Available
                pulseStyle = 'pulse-active';
              }
            }

            var html = '<div class="tech-marker-wrapper ' + pulseStyle + '" style="background-color: ' + color + '; border-color: #ffffff;">' +
                       '<span>' + initials + '</span>' +
                       '</div>';

            // Insert dynamic color to animation using inline style hacks
            if (pulseStyle) {
              html = html.replace('tech-marker-wrapper', 'tech-marker-wrapper" style="background-color: ' + color + '; --pulse-color: ' + color);
            }

            return L.divIcon({
              className: 'custom-tech-div-icon',
              html: html,
              iconSize: [36, 36],
              iconAnchor: [18, 18],
              popupAnchor: [0, -18]
            });
          }

          function updateMarkers(techs) {
            var boundsArray = [];
            
            // Remove markers not in updated list
            for (var id in markers) {
              if (!techs.find(function(t) { return t.id === id; })) {
                map.removeLayer(markers[id]);
                delete markers[id];
              }
            }

            // Add or update markers
            techs.forEach(function(t) {
              if (t.latitude && t.longitude) {
                var latLng = [t.latitude, t.longitude];
                boundsArray.push(latLng);

                // Status colors & texts
                var statusColor = '#6b7280';
                var statusLabel = 'Çevrimdışı';
                if (t.isOnline) {
                  if (t.status === 'OnField') {
                    statusColor = '#3b82f6';
                    statusLabel = 'Çevrimiçi / Sahada';
                  } else if (t.status === 'OnBreak') {
                    statusColor = '#f59e0b';
                    statusLabel = 'Çevrimiçi / Molada';
                  } else {
                    statusColor = '#10b981';
                    statusLabel = 'Çevrimiçi / Müsait';
                  }
                } else {
                  if (t.status === 'OffDuty') {
                    statusColor = '#6b7280';
                    statusLabel = 'Çevrimdışı / Mesai Dışı';
                  } else {
                    statusColor = '#6b7280';
                    statusLabel = 'Çevrimdışı';
                  }
                }

                var popupHtml = '<div class="popup-title">' + t.fullName + '</div>' +
                                '<div class="popup-info"><b>Telefon:</b> ' + (t.phone || '-') + '</div>' +
                                '<div class="popup-status" style="background: ' + statusColor + '20; color: ' + statusColor + '; border: 1px solid ' + statusColor + '40;">' + statusLabel + '</div>';

                var techIcon = createTechIcon(t);

                if (markers[t.id]) {
                  markers[t.id].setLatLng(latLng).setPopupContent(popupHtml).setIcon(techIcon);
                } else {
                  markers[t.id] = L.marker(latLng, { icon: techIcon }).addTo(map).bindPopup(popupHtml);
                }
              }
            });

            // Adjust view to fit all markers
            if (boundsArray.length > 0) {
              map.fitBounds(boundsArray, { padding: [50, 50], maxZoom: 14 });
            }
          }

          // Initial load
          var initialTechs = ${JSON.stringify(technicians)};
          updateMarkers(initialTechs);
        </script>
      </body>
      </html>
    `;
  };

  // Sync data dynamically on change
  useEffect(() => {
    if (webViewRef.current) {
      const jsCode = `
        if (typeof updateMarkers === 'function') {
          updateMarkers(${JSON.stringify(technicians)});
        }
        true;
      `;
      webViewRef.current.injectJavaScript(jsCode);
    }
  }, [technicians]);

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: generateHTML() }}
        style={styles.map}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: '#0c0c0c',
  },
  map: {
    flex: 1,
    backgroundColor: '#0c0c0c',
  },
});
