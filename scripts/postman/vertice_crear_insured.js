// ============================================================
// VERTICE — Crear Insured
// POST {{services-integrations}}/vertice/v1/cross/insured
// ============================================================
// 8 iteraciones: EP-01→EP-03, VL-01→VL-02, NEG-01→NEG-03
// NIT rota por iteración — dígito verificación DIAN (mod 11)
// ============================================================

// ============================================================
// PRE-REQUEST SCRIPT
// ============================================================

// ── Ambiente ──────────────────────────────────────────────────────────────
const envName   = pm.environment.name || "";
const isStaging = envName.toLowerCase().includes("staging");
const label     = isStaging ? "STAGING" : "TESTING";
const ENV       = isStaging ? "stg" : "tst";

const val = pm.environment.get("services-integrations");
if (val && val.endsWith("/")) {
  pm.environment.set("services-integrations", val.slice(0, -1));
}

// ── Índice temprano (necesario para seleccionar NIT antes de COMPACT_BODIES)
let idx = pm.info.iteration;

// ── NITs por ambiente (dígito verificación calculado con algoritmo DIAN) ──
const NITS = {
  testing: [
    { nit: "1098814754", empresa: "Minucipio SAS" },
    { nit: "9015541423", empresa: "EquiFluid SAS" },
    { nit: "9010926137", empresa: "MAXIMA RACING OIL COLOMBIA SAS" },
    { nit: "9006611141", empresa: "ARQ DISEÑO Y CONSTRUCCION SAS" },
    { nit: "9012452931", empresa: "EPACK SAS" },
    { nit: "9016455964", empresa: "ARMANDO PISOS Y DISEÑOS SAS" },
    { nit: "9018086623", empresa: "Mundimotos Llanos" },
    { nit: "9007293862", empresa: "DOBLE A LOGISTICA SAS" },
    { nit: "9018346917", empresa: "SEÑALIZACIONES Y CONSTRUCCIONES SC COLOMBIA SAS" },
    { nit: "9002599642", empresa: "ANIMAL AND PET SUPPLY S.A.S." },
    { nit: "8300509435", empresa: "ANFER DISTRIBUCIONES SAS" },
    { nit: "8140000644", empresa: "SYJ FULL SERVICES SAS" },
    { nit: "9014530840", empresa: "GRUPO DM IMPORTACIONES S.A.S" },
    { nit: "9011515092", empresa: "KOUT RECUBRIMIENTOS ESPECIALIZADOS S.A.S." },
    { nit: "9003953534", empresa: "ROBOPACK SAS" },
    { nit: "9012300732", empresa: "Nova Cargo SAS" },
    { nit: "9014792072", empresa: "Homeatelier s.a.s" },
    { nit: "10431344543", empresa: "IMPORTADORA JM" },
    { nit: "9014087965", empresa: "Aio SAS" },
    { nit: "9017417922", empresa: "CORPORACION INTERNACIONAL DE NEGOCIOS ITECOM SAS" },
    { nit: "9017713421", empresa: "Nutrifitmax" },
    { nit: "9012847068", empresa: "GRUPO GLOBAL IMPORTACIONES S.A.S." },
    { nit: "9003919306", empresa: "ENSAMBLES ZF S.A.S" }
  ],
  staging: [
    { nit: "8020227216", empresa: "GEE-RENOVABLES SAS" },
    { nit: "9013883252", empresa: "AGR CARGO S.A.S." },
    { nit: "9000766801", empresa: "DOTACIONES HOTELERAS ROMIL SAS." },
    { nit: "9010665920", empresa: "HELENA CABALLERO SAS" },
    { nit: "9003798971", empresa: "MOTOPLASTICOS SPEEDHARD SAS" },
    { nit: "9003262216", empresa: "APROGAN S.A.S." },
    { nit: "842748901",  empresa: "Luisf-import. SAS" },
    { nit: "9009850438", empresa: "EDUPROJECTS SAS" },
    { nit: "9008450491", empresa: "IMPORTADORA Y COMERCIALIZADORA LP S A S" },
    { nit: "9007185553", empresa: "KLEF S.A.S" },
    { nit: "9017200728", empresa: "INVERSIONES GLOBAL VISION SAS" },
    { nit: "9012988526", empresa: "LONKO INTERNATIONAL GROUP COLOMBIA SAS" },
    { nit: "8300695450", empresa: "CARDOGAL S.A.S." },
    { nit: "9016321173", empresa: "TRACTORZIPA SAS" },
    { nit: "9009338369", empresa: "IMPORFOOD PACIFIC BLUE SAS" }
  ]
};

const nitList = isStaging ? NITS.staging : NITS.testing;
if (isNaN(idx) || idx < 0) idx = 0;
const company = nitList[idx % nitList.length];
const NIT_OK  = company.nit;

// ── Catálogo de países ────────────────────────────────────────────────────
const PAIS = {
  COL: "Colombia", MEX: "México", ARS: "Argentina",
  USA: "Estados Unidos", BRA: "Brasil", PAN: "Panamá",
  ECU: "Ecuador", PER: "Perú", CHL: "Chile"
};

function makeName(pais) {
  return "[" + label + "] PRUEBA QA - " + company.empresa + " - " + (PAIS[pais] || pais);
}
function makeEmail(tag) {
  return "qa.vertice." + ENV + "." + tag + "@yopmail.com";
}

// ── Escenarios ────────────────────────────────────────────────────────────
const COMPACT_BODIES = [
  // EP-01 — COL, Logistic
  {
    body: {
      document_type: "NIT", document_number: NIT_OK,
      name: makeName("COL"), country: "COL",
      state: "Cundinamarca", city: "Bogotá",
      address: "Calle 100 # 15-20", zip_code: "0110111",
      emails: [makeEmail("ep01.col")], mobile_phone: "+573001234567",
      insured_type: 10, economic_activity: "Logistic"
    },
    path: {}, query: {}, headers: {}
  },
  // EP-02 — MEX, Custom Agents
  {
    body: {
      document_type: "NIT", document_number: NIT_OK,
      name: makeName("MEX"), country: "MEX",
      state: "CDMX", city: "Ciudad de México",
      address: "Av. Insurgentes Sur 1234", zip_code: "06600",
      emails: [makeEmail("ep02.mex")], mobile_phone: "+573001234567",
      insured_type: 10, economic_activity: "Custom Agents"
    },
    path: {}, query: {}, headers: {}
  },
  // EP-03 — ARS, Logistic
  {
    body: {
      document_type: "NIT", document_number: NIT_OK,
      name: makeName("ARS"), country: "ARS",
      state: "Buenos Aires", city: "Buenos Aires",
      address: "Av. Corrientes 456", zip_code: "1043",
      emails: [makeEmail("ep03.ars")], mobile_phone: "+573001234567",
      insured_type: 10, economic_activity: "Logistic"
    },
    path: {}, query: {}, headers: {}
  },
  // VL-01 — USA, Custom Agents
  {
    body: {
      document_type: "NIT", document_number: NIT_OK,
      name: makeName("USA"), country: "USA",
      state: "Florida", city: "Miami",
      address: "100 Brickell Ave", zip_code: "33131",
      emails: [makeEmail("vl01.usa")], mobile_phone: "+573001234567",
      insured_type: 10, economic_activity: "Custom Agents"
    },
    path: {}, query: {}, headers: {}
  },
  // VL-02 — BRA, Logistic
  {
    body: {
      document_type: "NIT", document_number: NIT_OK,
      name: makeName("BRA"), country: "BRA",
      state: "São Paulo", city: "São Paulo",
      address: "Av. Paulista 1000", zip_code: "01310-100",
      emails: [makeEmail("vl02.bra")], mobile_phone: "+573001234567",
      insured_type: 10, economic_activity: "Logistic"
    },
    path: {}, query: {}, headers: {}
  },
  // NEG-01 — document_number vacío
  {
    body: {
      document_type: "NIT", document_number: "",
      name: "[" + label + "] PRUEBA QA - NEG-01 Sin Documento", country: "COL",
      state: "Cundinamarca", city: "Bogotá",
      address: "Calle 100 # 15-20", zip_code: "0110111",
      emails: [makeEmail("neg01")], mobile_phone: "+573001234567",
      insured_type: 10, economic_activity: "Logistic"
    },
    path: {}, query: {}, headers: {}
  },
  // NEG-02 — country inválido
  {
    body: {
      document_type: "NIT", document_number: NIT_OK,
      name: "[" + label + "] PRUEBA QA - NEG-02 País Inválido", country: "INVALIDO",
      state: "Cundinamarca", city: "Bogotá",
      address: "Calle 100 # 15-20", zip_code: "0110111",
      emails: [makeEmail("neg02")], mobile_phone: "+573001234567",
      insured_type: 10, economic_activity: "Logistic"
    },
    path: {}, query: {}, headers: {}
  },
  // NEG-03 — email inválido
  {
    body: {
      document_type: "NIT", document_number: NIT_OK,
      name: "[" + label + "] PRUEBA QA - NEG-03 Email Inválido", country: "COL",
      state: "Cundinamarca", city: "Bogotá",
      address: "Calle 100 # 15-20", zip_code: "0110111",
      emails: ["no-es-un-email"], mobile_phone: "+573001234567",
      insured_type: 10, economic_activity: "Logistic"
    },
    path: {}, query: {}, headers: {}
  }
];

if (idx >= COMPACT_BODIES.length) idx = 0;
const s = COMPACT_BODIES[idx];
pm.collectionVariables.set("totalScenarios", String(COMPACT_BODIES.length));

(function injectObj(obj, prefix) {
  Object.entries(obj || {}).forEach(function(e) {
    var key = prefix ? prefix + "." + e[0] : e[0];
    var val = e[1];
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      injectObj(val, key);
    } else {
      pm.variables.set(key, val === null || val === undefined ? "" :
        typeof val === "object" ? JSON.stringify(val) : val);
    }
  });
})(s.body, "");

Object.entries(s.path || {}).forEach(function(e) { pm.variables.set(e[0], String(e[1] ?? "")); });
Object.entries(s.query || {}).forEach(function(e) { pm.variables.set(e[0], String(e[1] ?? "")); });
Object.entries(s.headers || {}).forEach(function(e) {
  pm.request.headers.upsert({ key: e[0], value: String(e[1] ?? "") });
});

pm.environment.set("insured.document_number", s.body.document_number);

console.log("[PRE] env=" + label + " idx=" + idx + " empresa=" + company.empresa + " nit=" + NIT_OK + " country=" + s.body.country + " email=" + s.body.emails[0]);


// ============================================================
// TEST SCRIPT
// ============================================================

const SCENARIO_META = [
  { name: "EP-01 | Happy Path - COL, Logistic",      type: "positive", status: [200, 201, 400] },
  { name: "EP-02 | Happy Path - MEX, Custom Agents", type: "positive", status: [200, 201, 400] },
  { name: "EP-03 | Happy Path - ARS, Logistic",      type: "positive", status: [200, 201, 400] },
  { name: "VL-01 | Boundary - USA, Custom Agents",   type: "positive", status: [200, 201, 400] },
  { name: "VL-02 | Boundary - BRA, Logistic",        type: "positive", status: [200, 201, 400] },
  { name: "NEG-01 | document_number vacío",          type: "negative", status: [400, 422] },
  { name: "NEG-02 | country code inválido",          type: "negative", status: [400, 422] },
  { name: "NEG-03 | email formato inválido",         type: "negative", status: [400, 422] }
];

const idx     = pm.info.iteration;
const total   = SCENARIO_META.length;
const meta    = SCENARIO_META[idx] || SCENARIO_META[0];
const lbl     = "[" + (idx + 1) + "/" + total + "] " + meta.name;
const docUsed = pm.environment.get("insured.document_number") || "";

pm.test(lbl + " — Status", function() {
  pm.expect(pm.response.code).to.be.oneOf(meta.status);
});

pm.test(lbl + " — Tiempo <30s", function() {
  pm.expect(pm.response.responseTime).to.be.below(30000);
});

pm.test(lbl + " — Content-Type JSON", function() {
  pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");
});

try {
  var body = pm.response.json();

  if (meta.type === "positive") {
    if (pm.response.code === 400) {
      pm.environment.set("insured.document_number", docUsed);
      pm.test(lbl + " — 400 por insured ya existente (esperado)", function() {
        var str = JSON.stringify(body).toLowerCase();
        pm.expect(str).to.satisfy(function(s) {
          return s.includes("already exists") || s.includes("ya existe") || s.includes("exists");
        });
      });
    } else {
      pm.environment.set("insured.document_number", body.document_number || docUsed);

      ["document_number", "name", "country", "economic_activity"].forEach(function(f) {
        pm.test(lbl + " — campo " + f + " presente", function() {
          pm.expect(body).to.have.property(f);
          pm.expect(body[f]).to.not.be.null;
          pm.expect(body[f]).to.not.equal("");
        });
      });

      var savedId = body.id || body.insured_id || body.customer_id;
      if (savedId) {
        pm.environment.set("last_insured_id", savedId);
        console.log("[TEST] insured_id guardado: " + savedId);
      }
    }
  } else {
    pm.test(lbl + " — body contiene error", function() {
      var str = JSON.stringify(body).toLowerCase();
      pm.expect(str).to.satisfy(function(s) {
        return s.includes("error") || s.includes("invalid") ||
               s.includes("required") || s.includes("detail");
      });
    });
  }

} catch(e) {
  console.log("[TEST] body parse error:", e.message);
}

console.log("[TEST] insured.document_number guardado: " + docUsed);
console.log("[TEST] done idx=" + idx + " status=" + pm.response.code);
if (idx + 1 >= total) console.log("[TEST] todos los escenarios completados (" + total + "/" + total + ")");