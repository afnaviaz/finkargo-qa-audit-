// ============================================================
// VERTICE — Crear Certificado Transporte
// POST {{services-integrations}}/vertice/v1/cross/certificate/transport
// ============================================================

// ============================================================
// PRE-REQUEST SCRIPT
// ============================================================
/*
Pega este bloque en la pestaña "Pre-request Script" del request.

Cicla por los registros usando un contador en la variable de entorno
"vertice_cert_index". Cada ejecución usa el siguiente registro.
*/

const testRecords = [
  // --- Caso 1: Happy path base (Electrodomésticos, COL → MX) ---
  {
    label: "Happy path base - Electrodomésticos COL→MX",
    insured: { document_number: "802022721" },
    commercial_invoice: 50000.00,
    merchandise_type: 20,
    transport_certificate_modes: [
      { transport_mode: 5, max_required_limit: 0, number_of_vehicles: 0 }
    ],
    merchandise_description: "Electrodomésticos",
    commodity: 23,
    weight: 500.0,
    journey_from: "Bogotá, Colombia",
    journey_to: "Ciudad de México, México",
    country_from: 1,
    country_to: 2,
    departure_date: "2026-06-01",
    do_number: "DO-2025-001",
    observation: "Carga frágil"
  },

  // --- Caso 2: Factura alta (>100k), ruta COL → USA ---
  {
    label: "Factura alta - Textiles COL→USA",
    insured: { document_number: "900123456" },
    commercial_invoice: 150000.00,
    merchandise_type: 10,
    transport_certificate_modes: [
      { transport_mode: 1, max_required_limit: 200000, number_of_vehicles: 2 }
    ],
    merchandise_description: "Textiles y confecciones",
    commodity: 15,
    weight: 1200.0,
    journey_from: "Medellín, Colombia",
    journey_to: "Miami, United States",
    country_from: 1,
    country_to: 3,
    departure_date: "2026-06-15",
    do_number: "DO-2025-002",
    observation: "Mercancía asegurada premium"
  },

  // --- Caso 3: Peso mínimo, factura baja ---
  {
    label: "Peso mínimo - Documentos COL→PAN",
    insured: { document_number: "1030456789" },
    commercial_invoice: 5000.00,
    merchandise_type: 5,
    transport_certificate_modes: [
      { transport_mode: 3, max_required_limit: 0, number_of_vehicles: 1 }
    ],
    merchandise_description: "Documentos y papelería",
    commodity: 5,
    weight: 10.0,
    journey_from: "Bogotá, Colombia",
    journey_to: "Ciudad de Panamá, Panamá",
    country_from: 1,
    country_to: 4,
    departure_date: "2026-07-01",
    do_number: "DO-2025-003",
    observation: ""
  },

  // --- Caso 4: Múltiples modos de transporte ---
  {
    label: "Multi-modo transporte - Maquinaria COL→ECU",
    insured: { document_number: "800789123" },
    commercial_invoice: 75000.00,
    merchandise_type: 30,
    transport_certificate_modes: [
      { transport_mode: 1, max_required_limit: 50000, number_of_vehicles: 1 },
      { transport_mode: 5, max_required_limit: 25000, number_of_vehicles: 1 }
    ],
    merchandise_description: "Maquinaria industrial",
    commodity: 30,
    weight: 3000.0,
    journey_from: "Cali, Colombia",
    journey_to: "Quito, Ecuador",
    country_from: 1,
    country_to: 5,
    departure_date: "2026-06-20",
    do_number: "DO-2025-004",
    observation: "Carga sobredimensionada"
  },

  // --- Caso 5: Factura en límite exacto (50000) con número de documento corto ---
  {
    label: "Límite exacto - Alimentos MX→COL",
    insured: { document_number: "12345678" },
    commercial_invoice: 50000.00,
    merchandise_type: 1,
    transport_certificate_modes: [
      { transport_mode: 2, max_required_limit: 0, number_of_vehicles: 3 }
    ],
    merchandise_description: "Alimentos procesados",
    commodity: 2,
    weight: 800.0,
    journey_from: "Ciudad de México, México",
    journey_to: "Bogotá, Colombia",
    country_from: 2,
    country_to: 1,
    departure_date: "2026-08-01",
    do_number: "DO-2025-005",
    observation: "Producto perecedero — cadena de frío"
  }
];

// Obtener y avanzar el índice
let index = parseInt(pm.environment.get("vertice_cert_index") || "0");
if (isNaN(index) || index >= testRecords.length) index = 0;

const record = testRecords[index];
pm.environment.set("vertice_cert_index", (index + 1) % testRecords.length);

// Inyectar el body dinámicamente
pm.environment.set("vertice_cert_body", JSON.stringify(record));
pm.environment.set("vertice_cert_label", record.label);

console.log(`[Pre-request] Ejecutando registro ${index + 1}/${testRecords.length}: ${record.label}`);


// ============================================================
// TEST SCRIPT
// ============================================================
/*
Pega este bloque en la pestaña "Tests" del request.
*/

const label = pm.environment.get("vertice_cert_label") || "–";
console.log(`[Tests] Validando: ${label}`);

// --- 1. Status code ---
pm.test(`[${label}] Status 201 Created`, () => {
    pm.response.to.have.status(201);
});

// --- 2. Content-Type JSON ---
pm.test(`[${label}] Content-Type es application/json`, () => {
    pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");
});

// --- 3. Response time razonable ---
pm.test(`[${label}] Response time < 30s`, () => {
    pm.expect(pm.response.responseTime).to.be.below(30000);
});

// --- 4. Body no vacío ---
pm.test(`[${label}] Body no está vacío`, () => {
    pm.expect(pm.response.text()).to.not.be.empty;
});

// Parseo seguro del body
let body;
try {
    body = pm.response.json();
} catch (e) {
    pm.test(`[${label}] Body es JSON válido`, () => {
        pm.expect.fail(`No se pudo parsear JSON: ${e.message}`);
    });
}

if (body) {
    // --- 5. Campos obligatorios presentes ---
    const requiredFields = [
        "certificate_id",
        "customer_id",
        "status",
        "commodity",
        "departure_date",
        "commercial_invoice",
        "do_number",
        "journey_from",
        "journey_to",
        "document_id",
        "document_name"
    ];

    requiredFields.forEach(field => {
        pm.test(`[${label}] Campo "${field}" presente`, () => {
            pm.expect(body).to.have.property(field);
            pm.expect(body[field]).to.not.be.null;
            pm.expect(body[field]).to.not.equal("");
        });
    });

    // --- 6. certificate_id es UUID válido ---
    pm.test(`[${label}] certificate_id es UUID`, () => {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        pm.expect(body.certificate_id).to.match(uuidRegex);
    });

    // --- 7. customer_id es UUID válido ---
    pm.test(`[${label}] customer_id es UUID`, () => {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        pm.expect(body.customer_id).to.match(uuidRegex);
    });

    // --- 8. document_id es UUID válido ---
    pm.test(`[${label}] document_id es UUID`, () => {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        pm.expect(body.document_id).to.match(uuidRegex);
    });

    // --- 9. Status es "Aprobado" ---
    pm.test(`[${label}] status = "Aprobado"`, () => {
        pm.expect(body.status).to.equal("Aprobado");
    });

    // --- 10. commercial_invoice es número positivo ---
    pm.test(`[${label}] commercial_invoice es número positivo`, () => {
        pm.expect(body.commercial_invoice).to.be.a("number");
        pm.expect(body.commercial_invoice).to.be.above(0);
    });

    // --- 11. document_name tiene formato esperado ---
    pm.test(`[${label}] document_name tiene formato Certificado_Transporte_*`, () => {
        pm.expect(body.document_name).to.match(/^Certificado_Transporte_/);
    });

    // --- 12. departure_date es formato ISO 8601 con offset ---
    pm.test(`[${label}] departure_date tiene formato ISO 8601`, () => {
        const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
        pm.expect(body.departure_date).to.match(isoRegex);
    });

    // --- 13. journey_from y journey_to no son iguales ---
    pm.test(`[${label}] journey_from ≠ journey_to`, () => {
        pm.expect(body.journey_from).to.not.equal(body.journey_to);
    });

    // --- 14. do_number no está vacío ---
    pm.test(`[${label}] do_number no está vacío`, () => {
        pm.expect(body.do_number).to.be.a("string").and.to.have.length.above(0);
    });

    // --- 15. Guardar certificate_id para uso posterior ---
    pm.environment.set("last_certificate_id", body.certificate_id);
    pm.environment.set("last_document_id", body.document_id);
    console.log(`[Tests] certificate_id guardado: ${body.certificate_id}`);
}