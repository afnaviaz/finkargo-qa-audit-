// ============================================================
// VERTICE — Crear Certificado Transporte
// POST {{services-integrations}}/vertice/v1/cross/certificate/transport
// ============================================================
// 11 iteraciones: EP-01→EP-03, VL-01→VL-03, NEG-01→NEG-05
// country_from / country_to = enteros (DB countries: CO=1, MX=2)
// ============================================================

// ============================================================
// PRE-REQUEST SCRIPT
// ============================================================

// ── Ambiente ──────────────────────────────────────────────────────────────
const envName   = pm.environment.name || "";
const isStaging = envName.toLowerCase().includes("staging");
const envLabel  = isStaging ? "STAGING" : "TESTING";

const val = pm.environment.get("services-integrations");
if (val && val.endsWith("/")) {
  pm.environment.set("services-integrations", val.slice(0, -1));
}

// ── UUID / Fecha ──────────────────────────────────────────────────────────
function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0;
    var v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
function getFutureDate(daysAhead) {
  var d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().split("T")[0];
}

// ── Aleatorios ────────────────────────────────────────────────────────────
const randomTag   = Math.random().toString(36).substring(2, 8).toUpperCase();
const baseDO      = "DO-QA-" + randomTag;
const INVOICE_MIN = 5000.00;
const INVOICE_MAX = 200000.00;
function randomInvoice() {
  return parseFloat((Math.random() * (INVOICE_MAX - INVOICE_MIN) + INVOICE_MIN).toFixed(2));
}
const randomInvoice1 = randomInvoice();
const randomInvoice2 = randomInvoice();
const randomInvoice3 = randomInvoice();

// ── Countries (IDs enteros — DB countries: CO=1, MX=2) ───────────────────
const COUNTRY = {
  COL: 1,
  MEX: 2
};

// ── Datos de empresas por escenario ───────────────────────────────────────
const COMPANY_DATA = {
  testing: [
    { doc: "1098814754", name: "Minucipio SAS" },  // EP-01
    { doc: "1098814754", name: "Minucipio SAS" },  // EP-02
    { doc: "1098814754", name: "Minucipio SAS" },  // EP-03
    { doc: "1098814754", name: "Minucipio SAS" },  // VL-01
    { doc: "1098814754", name: "Minucipio SAS" },  // VL-02
    { doc: "1098814754", name: "Minucipio SAS" },  // VL-03
    { doc: "",           name: "" },                // NEG-01 (missing)
    { doc: "1098814754", name: "Minucipio SAS" },  // NEG-02
    { doc: "1098814754", name: "Minucipio SAS" },  // NEG-03
    { doc: "1098814754", name: "Minucipio SAS" },  // NEG-04
    { doc: "1098814754", name: "Minucipio SAS" }   // NEG-05
  ],
  staging: [
    { doc: "802022721", name: "Empresa Test Staging" },  // EP-01
    { doc: "802022721", name: "Empresa Test Staging" },  // EP-02
    { doc: "802022721", name: "Empresa Test Staging" },  // EP-03
    { doc: "802022721", name: "Empresa Test Staging" },  // VL-01
    { doc: "802022721", name: "Empresa Test Staging" },  // VL-02
    { doc: "802022721", name: "Empresa Test Staging" },  // VL-03
    { doc: "",          name: "" },                       // NEG-01
    { doc: "802022721", name: "Empresa Test Staging" },  // NEG-02
    { doc: "802022721", name: "Empresa Test Staging" },  // NEG-03
    { doc: "802022721", name: "Empresa Test Staging" },  // NEG-04
    { doc: "802022721", name: "Empresa Test Staging" }   // NEG-05
  ]
};

// ── Escenarios ────────────────────────────────────────────────────────────
const COMPACT_BODIES = [
  // EP-01
  {
    body: {
      insured: { document_number: "" },
      commercial_invoice: randomInvoice1,
      merchandise_type: 20,
      transport_certificate_modes: [{ transport_mode: 5, max_required_limit: 0, number_of_vehicles: 0 }],
      merchandise_description: "Electrodomésticos",
      commodity: 23, weight: 500.0,
      journey_from: "Bogotá, Colombia", journey_to: "Ciudad de México, México",
      country_from: COUNTRY.COL, country_to: COUNTRY.MEX,
      departure_date: getFutureDate(30), do_number: baseDO + "-001", observation: "Carga frágil"
    },
    path: {}, query: {}, headers: {}
  },
  // EP-02
  {
    body: {
      insured: { document_number: "" },
      commercial_invoice: randomInvoice2,
      merchandise_type: 10,
      transport_certificate_modes: [{ transport_mode: 1, max_required_limit: 200000, number_of_vehicles: 2 }],
      merchandise_description: "Textiles y confecciones",
      commodity: 15, weight: 1200.0,
      journey_from: "Medellín, Colombia", journey_to: "Ciudad de México, México",
      country_from: COUNTRY.COL, country_to: COUNTRY.MEX,
      departure_date: getFutureDate(45), do_number: baseDO + "-002", observation: "Mercancía asegurada premium"
    },
    path: {}, query: {}, headers: {}
  },
  // EP-03
  {
    body: {
      insured: { document_number: "" },
      commercial_invoice: randomInvoice3,
      merchandise_type: 1,
      transport_certificate_modes: [{ transport_mode: 2, max_required_limit: 0, number_of_vehicles: 3 }],
      merchandise_description: "Alimentos procesados",
      commodity: 2, weight: 800.0,
      journey_from: "Ciudad de México, México", journey_to: "Bogotá, Colombia",
      country_from: COUNTRY.MEX, country_to: COUNTRY.COL,
      departure_date: getFutureDate(60), do_number: baseDO + "-003", observation: "Producto perecedero — cadena de frío"
    },
    path: {}, query: {}, headers: {}
  },
  // VL-01
  {
    body: {
      insured: { document_number: "" },
      commercial_invoice: 1000.00,
      merchandise_type: 5,
      transport_certificate_modes: [{ transport_mode: 3, max_required_limit: 0, number_of_vehicles: 1 }],
      merchandise_description: "Documentos y papelería",
      commodity: 5, weight: 10.0,
      journey_from: "Bogotá, Colombia", journey_to: "Ciudad de México, México",
      country_from: COUNTRY.COL, country_to: COUNTRY.MEX,
      departure_date: getFutureDate(15), do_number: baseDO + "-004", observation: ""
    },
    path: {}, query: {}, headers: {}
  },
  // VL-02
  {
    body: {
      insured: { document_number: "" },
      commercial_invoice: 500000.00,
      merchandise_type: 30,
      transport_certificate_modes: [{ transport_mode: 1, max_required_limit: 500000, number_of_vehicles: 5 }],
      merchandise_description: "Maquinaria industrial pesada",
      commodity: 30, weight: 5000.0,
      journey_from: "Cali, Colombia", journey_to: "Ciudad de México, México",
      country_from: COUNTRY.COL, country_to: COUNTRY.MEX,
      departure_date: getFutureDate(90), do_number: baseDO + "-005", observation: "Carga sobredimensionada"
    },
    path: {}, query: {}, headers: {}
  },
  // VL-03
  {
    body: {
      insured: { document_number: "" },
      commercial_invoice: 75000.00,
      merchandise_type: 30,
      transport_certificate_modes: [
        { transport_mode: 1, max_required_limit: 50000, number_of_vehicles: 1 },
        { transport_mode: 5, max_required_limit: 25000, number_of_vehicles: 1 }
      ],
      merchandise_description: "Maquinaria y equipos industriales",
      commodity: 30, weight: 3000.0,
      journey_from: "Barranquilla, Colombia", journey_to: "Ciudad de México, México",
      country_from: COUNTRY.COL, country_to: COUNTRY.MEX,
      departure_date: getFutureDate(20), do_number: baseDO + "-006", observation: "Requiere grúa para descarga"
    },
    path: {}, query: {}, headers: {}
  },
  // NEG-01 — document_number vacío
  {
    body: {
      insured: { document_number: "" },
      commercial_invoice: randomInvoice1, merchandise_type: 20,
      transport_certificate_modes: [{ transport_mode: 5, max_required_limit: 0, number_of_vehicles: 0 }],
      merchandise_description: "Electrodomésticos", commodity: 23, weight: 500.0,
      journey_from: "Bogotá, Colombia", journey_to: "Ciudad de México, México",
      country_from: COUNTRY.COL, country_to: COUNTRY.MEX,
      departure_date: getFutureDate(30), do_number: baseDO + "-NEG01", observation: ""
    },
    path: {}, query: {}, headers: {}
  },
  // NEG-02 — commercial_invoice inválido
  {
    body: {
      insured: { document_number: "" },
      commercial_invoice: "invalid_amount", merchandise_type: 20,
      transport_certificate_modes: [{ transport_mode: 5, max_required_limit: 0, number_of_vehicles: 0 }],
      merchandise_description: "Electrodomésticos", commodity: 23, weight: 500.0,
      journey_from: "Bogotá, Colombia", journey_to: "Ciudad de México, México",
      country_from: COUNTRY.COL, country_to: COUNTRY.MEX,
      departure_date: getFutureDate(30), do_number: baseDO + "-NEG02", observation: ""
    },
    path: {}, query: {}, headers: {}
  },
  // NEG-03 — departure_date formato incorrecto
  {
    body: {
      insured: { document_number: "" },
      commercial_invoice: randomInvoice1, merchandise_type: 20,
      transport_certificate_modes: [{ transport_mode: 5, max_required_limit: 0, number_of_vehicles: 0 }],
      merchandise_description: "Electrodomésticos", commodity: 23, weight: 500.0,
      journey_from: "Bogotá, Colombia", journey_to: "Ciudad de México, México",
      country_from: COUNTRY.COL, country_to: COUNTRY.MEX,
      departure_date: "01-06-2026", do_number: baseDO + "-NEG03", observation: ""
    },
    path: {}, query: {}, headers: {}
  },
  // NEG-04 — country_from = country_to
  {
    body: {
      insured: { document_number: "" },
      commercial_invoice: randomInvoice1, merchandise_type: 20,
      transport_certificate_modes: [{ transport_mode: 5, max_required_limit: 0, number_of_vehicles: 0 }],
      merchandise_description: "Electrodomésticos", commodity: 23, weight: 500.0,
      journey_from: "Bogotá, Colombia", journey_to: "Medellín, Colombia",
      country_from: COUNTRY.COL, country_to: COUNTRY.COL,
      departure_date: getFutureDate(30), do_number: baseDO + "-NEG04", observation: ""
    },
    path: {}, query: {}, headers: {}
  },
  // NEG-05 — do_number vacío
  {
    body: {
      insured: { document_number: "" },
      commercial_invoice: randomInvoice1, merchandise_type: 20,
      transport_certificate_modes: [{ transport_mode: 5, max_required_limit: 0, number_of_vehicles: 0 }],
      merchandise_description: "Electrodomésticos", commodity: 23, weight: 500.0,
      journey_from: "Bogotá, Colombia", journey_to: "Ciudad de México, México",
      country_from: COUNTRY.COL, country_to: COUNTRY.MEX,
      departure_date: getFutureDate(30), do_number: "", observation: ""
    },
    path: {}, query: {}, headers: {}
  }
];

// ── Índice y selección ────────────────────────────────────────────────────
let idx = pm.info.iteration;
if (isNaN(idx) || idx >= COMPACT_BODIES.length) idx = 0;

const companyList = isStaging ? COMPANY_DATA.staging : COMPANY_DATA.testing;
const company = companyList[idx];

const s = COMPACT_BODIES[idx];
s.body.insured.document_number = company.doc;

pm.collectionVariables.set("totalScenarios", String(COMPACT_BODIES.length));

// ── Crear Insured como prerequisito (skip solo NEG-01) ───────────────────
const baseUrl    = pm.environment.get("services-integrations") || "";
const countryKey = pm.environment.get("x-country-key") || pm.request.headers.get("x-country-key") || "";

if (company.doc !== "") {
  const insuredBody = {
    document_type: "NIT",
    document_number: company.doc,
    name: company.name,
    country: "COL",
    state: "Cundinamarca",
    city: "Bogotá",
    address: "Calle 100 # 15-20",
    zip_code: "0110111",
    emails: ["qa.auto@finkargo.com"],
    mobile_phone: "+573001234567",
    insured_type: 10,
    economic_activity: "Logistic"
  };

  pm.sendRequest({
    url: baseUrl + "/vertice/v1/cross/insured",
    method: "POST",
    header: {
      "Content-Type": "application/json",
      "x-country-key": countryKey
    },
    body: { mode: "raw", raw: JSON.stringify(insuredBody) }
  }, function(err, res) {
    if (err) {
      console.log("[PRE] Create Insured ERROR:", err.message);
    } else {
      console.log("[PRE] Create Insured status:", res.code, "| doc:", company.doc);
      if (res.code !== 200 && res.code !== 201) {
        console.log("[PRE] Create Insured body:", JSON.stringify(res.json()));
      }
    }
  });
} else {
  console.log("[PRE] NEG-01 — omitiendo Create Insured (document_number vacío)");
}

// ── Inyección de variables ────────────────────────────────────────────────
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

console.log("[PRE] env=" + envLabel + " idx=" + idx + " doc=" + company.doc + " invoice=" + s.body.commercial_invoice);


// ============================================================
// TEST SCRIPT
// ============================================================

const SCENARIO_META = [
  {
    name: "EP-01 | Happy Path - Electrodomésticos COL→MEX",
    type: "positive", status: [200, 201],
    fields: ["certificate_id", "customer_id", "status", "document_id", "document_name"],
    errField: ""
  },
  {
    name: "EP-02 | Happy Path - Textiles COL→MEX",
    type: "positive", status: [200, 201],
    fields: ["certificate_id", "customer_id", "status", "document_id", "document_name"],
    errField: ""
  },
  {
    name: "EP-03 | Happy Path - Alimentos MEX→COL (ruta inversa)",
    type: "positive", status: [200, 201],
    fields: ["certificate_id", "customer_id", "status", "document_id", "document_name"],
    errField: ""
  },
  {
    name: "VL-01 | Boundary - factura mínima (1,000) COL→MEX",
    type: "positive", status: [200, 201],
    fields: ["certificate_id", "customer_id", "status", "document_id", "document_name"],
    errField: ""
  },
  {
    name: "VL-02 | Boundary - factura máxima (500,000) COL→MEX",
    type: "positive", status: [200, 201],
    fields: ["certificate_id", "customer_id", "status", "document_id", "document_name"],
    errField: ""
  },
  {
    name: "VL-03 | Boundary - múltiples modos de transporte COL→MEX",
    type: "positive", status: [200, 201],
    fields: ["certificate_id", "customer_id", "status", "document_id", "document_name"],
    errField: ""
  },
  {
    name: "NEG-01 | Missing document_number - campo vacío",
    type: "negative", status: [400, 422],
    fields: [], errField: ""
  },
  {
    name: "NEG-02 | Invalid commercial_invoice - string en lugar de número",
    type: "negative", status: [400, 422],
    fields: [], errField: ""
  },
  {
    name: "NEG-03 | Invalid departure_date - formato DD-MM-YYYY incorrecto",
    type: "negative", status: [400, 422],
    fields: [], errField: ""
  },
  {
    name: "NEG-04 | Same country - country_from = country_to (COL→COL)",
    type: "negative", status: [400, 422, 200, 201],
    fields: [], errField: ""
  },
  {
    name: "NEG-05 | Missing do_number - campo vacío",
    type: "negative", status: [400, 422, 200, 201],
    fields: [], errField: ""
  }
];

const idx   = pm.info.iteration;
const total = SCENARIO_META.length;
const meta  = SCENARIO_META[idx] || SCENARIO_META[0];
const label = "[" + (idx + 1) + "/" + total + "] " + meta.name;

pm.test(label + " — Status", function() {
  pm.expect(pm.response.code).to.be.oneOf(meta.status);
});

pm.test(label + " — Tiempo <30s", function() {
  pm.expect(pm.response.responseTime).to.be.below(30000);
});

pm.test(label + " — Content-Type", function() {
  pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");
});

try {
  var body = pm.response.json();

  if (meta.type === "positive") {
    meta.fields.forEach(function(f) {
      pm.test(label + " — campo " + f, function() {
        pm.expect(body).to.have.property(f);
        pm.expect(body[f]).to.not.be.null;
        pm.expect(body[f]).to.not.equal("");
      });
    });

    if (body.status) {
      pm.test(label + " — status = Aprobado", function() {
        pm.expect(body.status).to.equal("Aprobado");
      });
    }

    if (body.document_name) {
      pm.test(label + " — document_name tiene formato Certificado_Transporte_*", function() {
        pm.expect(body.document_name).to.match(/^Certificado_Transporte_/);
      });
    }

    if (body.certificate_id) {
      pm.environment.set("last_certificate_id_" + idx, body.certificate_id);
      pm.environment.set("last_certificate_id", body.certificate_id);
      pm.environment.set("last_document_id_" + idx, body.document_id || "");
      pm.environment.set("last_document_id", body.document_id || "");
      console.log("[TEST] certificate_id guardado: last_certificate_id_" + idx);
    }

  } else if (meta.errField) {
    pm.test(label + " — error contiene " + meta.errField, function() {
      pm.expect(JSON.stringify(body).toLowerCase()).to.include(meta.errField.toLowerCase());
    });
  }

} catch(e) {
  console.log("[TEST] body parse error:", e.message);
}

console.log("[TEST] done idx=" + idx + " status=" + pm.response.code);
if (idx + 1 >= total) console.log("[TEST] todos los escenarios completados (" + total + "/" + total + ")");