import * as turf from "@turf/turf"; const pt = turf.point([0, 0]); const b = turf.buffer(pt, 2, { units: "kilometers" }); console.log(b.type, b.features);
