// Where each FBS college football team plays (its campus town, to about a mile or two), so Sports can
// show the teams in your local market: the ones near the ZIP chosen in Weather. ESPN's team list
// (which the phone loads) has no locations, so the teams are matched to this table by name.

/** [ESPN display name, latitude, longitude], with alternative names after a "|". */
const SITES = `
Boston College Eagles,42.335,-71.168
California Golden Bears|Cal Golden Bears,37.871,-122.259
Clemson Tigers,34.678,-82.837
Duke Blue Devils,36.001,-78.939
Florida State Seminoles,30.438,-84.281
Georgia Tech Yellow Jackets,33.776,-84.398
Louisville Cardinals,38.212,-85.759
Miami Hurricanes,25.72,-80.28
NC State Wolfpack,35.785,-78.682
North Carolina Tar Heels,35.905,-79.047
Pittsburgh Panthers,40.444,-79.953
SMU Mustangs,32.841,-96.784
Stanford Cardinal,37.427,-122.17
Syracuse Orange,43.036,-76.136
Virginia Cavaliers,38.034,-78.508
Virginia Tech Hokies,37.229,-80.424
Wake Forest Demon Deacons,36.133,-80.277
Illinois Fighting Illini,40.102,-88.227
Indiana Hoosiers,39.168,-86.523
Iowa Hawkeyes,41.661,-91.536
Maryland Terrapins,38.986,-76.943
Michigan Wolverines,42.278,-83.738
Michigan State Spartans,42.701,-84.482
Minnesota Golden Gophers,44.974,-93.228
Nebraska Cornhuskers,40.821,-96.705
Northwestern Wildcats,42.056,-87.675
Ohio State Buckeyes,40.002,-83.016
Oregon Ducks,44.045,-123.072
Penn State Nittany Lions,40.798,-77.86
Purdue Boilermakers,40.424,-86.921
Rutgers Scarlet Knights,40.501,-74.447
UCLA Bruins,34.069,-118.445
USC Trojans,34.022,-118.285
Washington Huskies,47.655,-122.303
Wisconsin Badgers,43.076,-89.412
Arizona Wildcats,32.232,-110.95
Arizona State Sun Devils,33.424,-111.928
Baylor Bears,31.547,-97.114
BYU Cougars,40.252,-111.649
UCF Knights,28.602,-81.2
Cincinnati Bearcats,39.13,-84.515
Colorado Buffaloes,40.009,-105.267
Houston Cougars,29.72,-95.343
Iowa State Cyclones,42.027,-93.648
Kansas Jayhawks,38.958,-95.252
Kansas State Wildcats,39.191,-96.582
Oklahoma State Cowboys,36.127,-97.069
TCU Horned Frogs,32.71,-97.363
Texas Tech Red Raiders,33.584,-101.875
Utah Utes,40.765,-111.849
West Virginia Mountaineers,39.635,-79.955
Alabama Crimson Tide,33.209,-87.569
Arkansas Razorbacks,36.068,-94.175
Auburn Tigers,32.603,-85.487
Florida Gators,29.65,-82.349
Georgia Bulldogs,33.948,-83.377
Kentucky Wildcats,38.03,-84.504
LSU Tigers,30.412,-91.184
Mississippi State Bulldogs,33.456,-88.794
Missouri Tigers,38.94,-92.328
Oklahoma Sooners,35.206,-97.442
Ole Miss Rebels,34.365,-89.538
South Carolina Gamecocks,33.994,-81.03
Tennessee Volunteers,35.955,-83.925
Texas Longhorns,30.284,-97.733
Texas A&M Aggies,30.61,-96.34
Vanderbilt Commodores,36.144,-86.809
Oregon State Beavers,44.565,-123.279
Washington State Cougars,46.732,-117.16
Air Force Falcons,38.997,-104.844
Boise State Broncos,43.603,-116.196
Colorado State Rams,40.571,-105.085
Fresno State Bulldogs,36.814,-119.749
Hawai'i Rainbow Warriors|Hawaii Rainbow Warriors,21.297,-157.817
Nevada Wolf Pack,39.545,-119.816
New Mexico Lobos,35.084,-106.62
San Diego State Aztecs,32.775,-117.07
San José State Spartans|San Jose State Spartans,37.335,-121.881
UNLV Rebels,36.108,-115.144
Utah State Aggies,41.745,-111.81
Wyoming Cowboys,41.313,-105.581
Army Black Knights,41.389,-73.956
Charlotte 49ers,35.307,-80.733
East Carolina Pirates,35.607,-77.366
Florida Atlantic Owls,26.373,-80.102
Memphis Tigers,35.12,-89.977
Navy Midshipmen,38.985,-76.507
North Texas Mean Green,33.211,-97.148
Rice Owls,29.717,-95.403
South Florida Bulls,28.059,-82.414
Temple Owls,39.981,-75.155
Tulane Green Wave,29.94,-90.12
Tulsa Golden Hurricane,36.152,-95.946
UAB Blazers,33.502,-86.809
UTSA Roadrunners,29.583,-98.619
Delaware Blue Hens,39.678,-75.751
Florida International Panthers|FIU Panthers,25.756,-80.374
Jacksonville State Gamecocks,33.82,-85.765
Kennesaw State Owls,34.038,-84.583
Liberty Flames,37.352,-79.178
Louisiana Tech Bulldogs,32.528,-92.648
Middle Tennessee Blue Raiders,35.849,-86.367
Missouri State Bears,37.2,-93.282
New Mexico State Aggies,32.279,-106.748
Sam Houston Bearkats|Sam Houston State Bearkats,30.715,-95.547
UTEP Miners,31.771,-106.505
Western Kentucky Hilltoppers,36.985,-86.457
Akron Zips,41.075,-81.512
Ball State Cardinals,40.206,-85.409
Bowling Green Falcons,41.378,-83.628
Buffalo Bulls,43.001,-78.789
Central Michigan Chippewas,43.59,-84.775
Eastern Michigan Eagles,42.25,-83.624
Kent State Golden Flashes,41.146,-81.342
Massachusetts Minutemen|UMass Minutemen,42.386,-72.53
Miami (OH) RedHawks|Miami RedHawks,39.51,-84.735
Northern Illinois Huskies,41.934,-88.773
Ohio Bobcats,39.324,-82.101
Toledo Rockets,41.657,-83.614
Western Michigan Broncos,42.283,-85.614
App State Mountaineers|Appalachian State Mountaineers,36.214,-81.68
Arkansas State Red Wolves,35.843,-90.676
Coastal Carolina Chanticleers,33.795,-79.012
Georgia Southern Eagles,32.42,-81.783
Georgia State Panthers,33.735,-84.389
James Madison Dukes,38.435,-78.87
Louisiana Ragin' Cajuns,30.211,-92.019
UL Monroe Warhawks|Louisiana-Monroe Warhawks,32.53,-92.073
Marshall Thundering Herd,38.423,-82.426
Old Dominion Monarchs,36.886,-76.305
South Alabama Jaguars,30.696,-88.178
Southern Miss Golden Eagles,31.329,-89.333
Texas State Bobcats,29.889,-97.938
Troy Trojans,31.8,-85.958
Notre Dame Fighting Irish,41.698,-86.234
UConn Huskies,41.808,-72.254
`;

/** Lower case, accents and punctuation gone: "San José State" and "San Jose State" match. */
export const normName = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const COLLEGE_SITES = new Map();
for (const line of SITES.trim().split('\n')) {
  const [names, lat, lon] = line.split(',');
  for (const n of names.split('|')) COLLEGE_SITES.set(normName(n), { name: names.split('|')[0], lat: +lat, lon: +lon });
}

/** Miles between two points (great circle). */
export function miles(a, b) {
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

/**
 * The college football teams in the local market of `place` ({ lat, lon }): the ESPN teams (from its
 * team list: [{ id, abbr, name, color }]) whose campus is within `radius` miles, nearest first; when
 * none is that close, the nearest `fallback`. Each comes back with its distance in miles.
 */
export function nearbyColleges(teams, place, { radius = 150, max = 6, fallback = 2 } = {}) {
  const found = [];
  for (const t of teams) {
    const site = COLLEGE_SITES.get(normName(t.name));
    if (site) found.push({ ...t, miles: Math.round(miles(place, site)) });
  }
  found.sort((a, b) => a.miles - b.miles || a.name.localeCompare(b.name));
  const near = found.filter((t) => t.miles <= radius);
  return (near.length ? near : found.slice(0, fallback)).slice(0, max);
}
