import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadQmlJs(relPath) {
  return readFileSync(join(__dirname, relPath), 'utf8')
    .replace(/^\.pragma\s+library\s*$/m, '')
    .replace(/^\.import\s+.+$/gm, '');
}

function buildModule(source, dependencies = {}) {
  const functionNames = [...source.matchAll(/^function\s+(\w+)\s*\(/gm)].map(match => match[1]);
  const variableNames = [...source.matchAll(/^var\s+(\w+)\s*=/gm)].map(match => match[1]);
  const exports = [...functionNames, ...variableNames]
    .map(name => `${name}: typeof ${name} !== 'undefined' ? ${name} : undefined`)
    .join(',\n');
  const names = Object.keys(dependencies);
  const values = Object.values(dependencies);
  return new Function(...names, `${source}\nreturn {${exports}};`)(...values);
}

const PotensicV2Output = buildModule(loadQmlJs('output/potensic_v2.js'));
const PotensicV3Output = buildModule(
  loadQmlJs('output/potensic_v3.js'),
  { PotensicV2Output },
);
const Specs = buildModule(loadQmlJs('generate/drone_specs.js'));
const Params = buildModule(loadQmlJs('generate/parameters.js'), { Specs });
const mainQml = readFileSync(join(__dirname, 'main.qml'), 'utf8');
const dialogQml = readFileSync(join(__dirname, 'FlightplanDialog.qml'), 'utf8');

const features = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [14.3036601, 45.3326784, 50] },
      properties: { take_photo: true, gimbal_angle: '-90', speed: 5 },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [14.3036458, 45.3301753, 50] },
      properties: { take_photo: false, gimbal_angle: -90, speed: 5 },
    },
  ],
};

const timestamp = 1786984375375;
const result = PotensicV3Output.createPotensicZip(features, 10, timestamp);
const globalJson = JSON.parse(result.globalJson);
const waypoints = JSON.parse(result.missionJson);

assert.equal(globalJson.speed, 5);
assert.equal(result.missionJson.includes(';[]'), false);
assert.equal(waypoints.length, 2);
assert.deepEqual(waypoints[0], {
  action: 'PHOTO',
  gimbalPitch: -90,
  gimbalType: 'DEFINE',
  height: 50,
  hoverTime: 0,
  lat: 45.3326784,
  lng: 14.3036601,
  poiHeight: 50,
  poiLat: 0,
  poiLng: 0,
  poiType: 0,
  speed: 5,
  speedType: 'GLOBAL',
  yaw: 0,
  yawType: 'TO_WAYPOINT',
  zoomRatio: 1,
  zoomType: 'HAND',
});
assert.equal('fileName' in waypoints[0], false);
assert.equal(waypoints[1].action, 'NONE');
assert.equal(new Uint8Array(result.zipData).slice(0, 4).join(','), '80,75,3,4');

assert.throws(
  () => PotensicV3Output.createPotensicZip({ type: 'FeatureCollection', features: [] }),
  /No features found/,
);
assert.equal(Specs.DroneType.POTENSIC_ATOM_3, 'POTENSIC_ATOM_3');
assert.equal(Specs.DRONE_PARAMS.POTENSIC_ATOM_3.OUTPUT_FORMAT, 'POTENSIC_JSON_V2');
assert.equal(
  Params.calculateParameters(0, 70, 120, null, 2, 'POTENSIC_ATOM_3').ground_speed,
  10,
);
assert.equal(
  Params.calculateParameters(99, 70, 10, null, 2, 'POTENSIC_ATOM_3').ground_speed,
  0.5,
);

const tooManyWaypoints = {
  type: 'FeatureCollection',
  features: Array.from({ length: 201 }, () => features.features[0]),
};
assert.throws(
  () => PotensicV3Output.createPotensicZip(tooManyWaypoints, 5, timestamp),
  /support at most 200 waypoints; received 201/,
);
assert.match(mainQml, /import "output\/potensic_v3\.js" as PotensicV3Output/);
assert.match(mainQml, /droneType === "POTENSIC_ATOM_3"/);
assert.match(mainQml, /PotensicV3Output\.createPotensicZip/);
assert.match(dialogQml, /"Potensic Atom 3"/);
assert.match(dialogQml, /"POTENSIC_ATOM_3"/);
assert.match(dialogQml, /Rename the generated timestamped \.json/);

console.log('Potensic Atom 3 QField serializer: PASS');
