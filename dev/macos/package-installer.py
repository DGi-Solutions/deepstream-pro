#!/usr/bin/env python3
"""Create the signed German/English macOS installer; no installation is run."""
import argparse
import html
import json
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser()
parser.add_argument('app', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--identity', required=True, help='Developer ID Installer identity')
args = parser.parse_args()
app = args.app.resolve(strict=True)
output = args.output.resolve()
assert not output.exists(), 'Choose a new output directory'
output.mkdir(mode=0o700, parents=True)
source = Path(__file__).resolve().parents[2]
info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
assert info['CFBundleIdentifier'] == 'local.dgi.DeepStreamPro'
version = info['CFBundleVersion']
assert re.fullmatch(r'\d+\.\d+\.\d+', version), 'Installer version must be numeric'
subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
resources = output / 'Resources'
resources.mkdir()
shutil.copy2(source / 'LICENSE', resources / 'LICENSE.txt')
shutil.copy2(source / 'docs/assets/deepstream-pro.png', resources / 'logo.png')
pages = {
    'de': ('Willkommen bei DeepStream Pro', 'Version 0.3 für Apple Silicon', 'Filmwiedergabe über deinen Jellyfin-Server, mit Audiodetails und experimentellem Spatial Audio für AirPods.', 'Benötigt macOS 27.2 oder neuer. Die App wird unter „Programme“ installiert.', 'Installation abgeschlossen', 'Öffne DeepStream Pro unter „Programme“ und verbinde deinen Jellyfin-Server. Die Sprache wählst du in den Profileinstellungen.'),
    'en': ('Welcome to DeepStream Pro', 'Version 0.3 for Apple Silicon', 'Play movies from your Jellyfin server, with audio information and experimental Spatial Audio for AirPods.', 'Requires macOS 27.2 or later. The app is installed in Applications.', 'Installation complete', 'Open DeepStream Pro in Applications and connect your Jellyfin server. Choose your language in the profile settings.')
}
for language, (title, subtitle, description, requirements, conclusion, next_step) in pages.items():
    folder = resources / (language + '.lproj')
    folder.mkdir()
    def page(heading, paragraphs):
        return '<!doctype html><html lang="' + language + '"><meta charset="utf-8"><style>body{font:14px -apple-system,sans-serif;background:#111;color:#e9e5de;margin:30px;line-height:1.6}h1{font-size:26px;color:#e7bd7c}img{width:72px;border-radius:14px}small{color:#b6afa3}</style><img src="../logo.png" alt="DeepStream Pro"><h1>' + html.escape(heading) + '</h1>' + ''.join('<p>' + html.escape(text) + '</p>' for text in paragraphs) + '<small>DeepStream Pro · DGi Solutions</small></html>'
    (folder / 'Welcome.html').write_text(page(title, [subtitle, description, requirements]), encoding='utf-8')
    (folder / 'Conclusion.html').write_text(page(conclusion, [next_step]), encoding='utf-8')
components = output / 'components.plist'
payload = output / 'Payload'
payload.mkdir()
subprocess.run(['ditto', str(app), str(payload / app.name)], check=True)
subprocess.run(['pkgbuild', '--analyze', '--root', str(payload), str(components)], check=True)
entries = plistlib.loads(components.read_bytes())
for entry in entries:
    entry['BundleIsRelocatable'] = False
    entry['BundleHasStrictIdentifier'] = True
    entry['BundleIsVersionChecked'] = False
    entry['BundleOverwriteAction'] = 'upgrade'
components.write_bytes(plistlib.dumps(entries))
identifier = 'de.dgi-solutions.deepstream-pro'
component = output / 'DeepStream-Pro-component.pkg'
subprocess.run(['pkgbuild', '--root', str(payload), '--component-plist', str(components), '--identifier', identifier, '--version', version, '--install-location', '/Applications', str(component)], check=True)
distribution = ET.Element('installer-gui-script', {'minSpecVersion': '2'})
ET.SubElement(distribution, 'title').text = 'DeepStream Pro 0.3'
ET.SubElement(distribution, 'welcome', {'file': 'Welcome.html'})
ET.SubElement(distribution, 'license', {'file': 'LICENSE.txt', 'mime-type': 'text/plain'})
ET.SubElement(distribution, 'conclusion', {'file': 'Conclusion.html'})
ET.SubElement(distribution, 'options', {'customize': 'never', 'require-scripts': 'false', 'hostArchitectures': 'arm64'})
ET.SubElement(distribution, 'domains', {'enable_localSystem': 'true', 'enable_anywhere': 'false', 'enable_currentUserHome': 'false'})
allowed = ET.SubElement(ET.SubElement(distribution, 'volume-check'), 'allowed-os-versions')
ET.SubElement(allowed, 'os-version', {'min': '27.2'})
outline = ET.SubElement(distribution, 'choices-outline')
ET.SubElement(outline, 'line', {'choice': 'application'})
choice = ET.SubElement(distribution, 'choice', {'id': 'application', 'visible': 'false', 'title': 'DeepStream Pro'})
ET.SubElement(choice, 'pkg-ref', {'id': identifier})
ET.SubElement(distribution, 'pkg-ref', {'id': identifier, 'version': version, 'onConclusion': 'none'}).text = component.name
xml = output / 'Distribution.xml'
ET.ElementTree(distribution).write(xml, encoding='utf-8', xml_declaration=True)
package = output / 'DeepStream-Pro-0.3.0-macOS-Apple-Silicon.pkg'
subprocess.run(['productbuild', '--distribution', str(xml), '--package-path', str(output), '--resources', str(resources), '--sign', args.identity, '--timestamp', str(package)], check=True)
subprocess.run(['pkgutil', '--check-signature', str(package)], check=True)
print(json.dumps({'installer': str(package), 'version': version, 'minimum_macos': '27.2', 'architecture': 'arm64', 'languages': ['de', 'en']}))
