// ============================================================
// EPAYMENTS2 MX — Exchange Quote
// POST {{api-epayments2}}/v1/mx/exchange-quote
// ============================================================
// Flujo: genera monto y spread aleatorios, llama al endpoint,
// valida la respuesta y guarda variables para Create Payment.
// ============================================================


// ============================================================
// PRE-REQUEST SCRIPT
// ============================================================

// ── Normalizar base URL ───────────────────────────────────────
// Fallback si api-epayments2 llega vacío desde Newman
if (!pm.environment.get("api-epayments2")) {
    const isStaging = (pm.environment.name || "").toLowerCase().includes("staging");
    pm.environment.set("api-epayments2", isStaging
        ? "https://api-epayments-staging.back.finkargo.com.mx"
        : "https://api-epayments-testing.back.finkargo.com.mx"
    );
}

const val = pm.environment.get("api-epayments2");
if (val && val.endsWith("/")) {
    pm.environment.set("api-epayments2", val.slice(0, -1));
}

// ── Montos aleatorios ─────────────────────────────────────────
const value = Math.floor(Math.random() * (50000 - 10001 + 1)) + 10001;
pm.environment.set("epay_value_req", value);

const spread = Math.floor(Math.random() * (10 - 5 + 1)) + 5;
pm.environment.set("epay_spread_req", spread);

// ── Debug ─────────────────────────────────────────────────────
console.log("Random initial_amount:", value);
console.log("Random spread:", spread);
console.log("Base URL:", pm.environment.get("api-epayments2"));


// ============================================================
// REQUEST BODY (pegar en Postman → Body → raw → JSON)
// ============================================================
/*
{
    "initialCurrency": "USD",
    "finalCurrency": "MXN",
    "initial_amount": {{epay_value_req}},
    "spred": {{epay_spread_req}}
}
*/


// ============================================================
// TEST SCRIPT
// ============================================================

// Status
pm.test("Status code is 201", function () {
    pm.response.to.have.status(201);
});

const jsonData = pm.response.json();

// Estructura — todos los campos obligatorios presentes
pm.test("Response has all required fields", function () {
    [
        "id",
        "external_id",
        "initial_currency",
        "final_currency",
        "amount",
        "exchange_amount",
        "exchange_rate",
        "update_at",
        "created_at"
    ].forEach(function (f) {
        pm.expect(jsonData, "campo " + f + " faltante").to.have.property(f);
    });
});

// Content-Type
pm.test("Content-Type es application/json", function () {
    pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");
});

// Tiempo de respuesta
pm.test("Tiempo de respuesta menor a 10000ms", function () {
    pm.expect(pm.response.responseTime).to.be.below(10000);
});

// Tipos de datos
// NOTA: en epayments2, amount y exchange_amount vienen como number (float),
// exchange_rate viene como string. Difiere de la API de Cobre donde son strings.
pm.test("Validate data types", function () {
    pm.expect(jsonData.id,               "id debe ser string").to.be.a("string");
    pm.expect(jsonData.external_id,      "external_id debe ser string").to.be.a("string");
    pm.expect(jsonData.initial_currency, "initial_currency debe ser string").to.be.a("string");
    pm.expect(jsonData.final_currency,   "final_currency debe ser string").to.be.a("string");
    pm.expect(jsonData.amount,           "amount debe ser number").to.be.a("number");
    pm.expect(jsonData.exchange_amount,  "exchange_amount debe ser number").to.be.a("number");
    pm.expect(jsonData.exchange_rate,    "exchange_rate debe ser string").to.be.a("string");
    pm.expect(jsonData.update_at,        "update_at debe ser string").to.be.a("string");
    pm.expect(jsonData.created_at,       "created_at debe ser string").to.be.a("string");
});

// Monedas
pm.test("Currencies are correct", function () {
    pm.expect(jsonData.initial_currency).to.eql("USD");
    pm.expect(jsonData.final_currency).to.eql("MXN");
});

// UUID válido en id
pm.test("id is valid UUID", function () {
    pm.expect(jsonData.id).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
});

// external_id no vacío
pm.test("external_id is not empty", function () {
    pm.expect(jsonData.external_id).to.not.be.empty;
});

// Valores positivos
pm.test("Amounts are positive", function () {
    pm.expect(jsonData.amount).to.be.above(0);
    pm.expect(jsonData.exchange_amount).to.be.above(0);
    pm.expect(parseFloat(jsonData.exchange_rate)).to.be.above(0);
});

// Fechas válidas
pm.test("Dates are valid ISO strings", function () {
    pm.expect(new Date(jsonData.update_at).toString()).to.not.eql("Invalid Date");
    pm.expect(new Date(jsonData.created_at).toString()).to.not.eql("Invalid Date");
});

// Lógica matemática: amount * exchange_rate ≈ exchange_amount
pm.test("Exchange calculation is correct", function () {
    const amount      = jsonData.amount;
    const rate        = parseFloat(jsonData.exchange_rate);
    const exchangeAmt = jsonData.exchange_amount;
    pm.expect(exchangeAmt).to.be.closeTo(amount * rate, 1);
});

// Guardar variables para Create Payment
pm.environment.set("epay_quote_external_id", jsonData.external_id);  // → quote_id en create-payment
pm.environment.set("epay_quote_internal_id", jsonData.id);            // → validar quote_Id en response
pm.environment.set("epay_value",             jsonData.amount);
pm.environment.set("epay_exchange_amount",   jsonData.exchange_amount);
pm.environment.set("epay_exchange_rate",     parseFloat(jsonData.exchange_rate));

// Verificar que se guardaron
pm.test("Environment variables saved correctly", function () {
    pm.expect(pm.environment.get("epay_quote_external_id")).to.not.be.undefined;
    pm.expect(pm.environment.get("epay_value")).to.not.be.undefined;
});

// Debug
console.log("QUOTE id:",              jsonData.id);
console.log("QUOTE external_id:",     jsonData.external_id);
console.log("QUOTE amount:",          jsonData.amount);
console.log("QUOTE exchange_amount:", jsonData.exchange_amount);
console.log("QUOTE exchange_rate:",   jsonData.exchange_rate);
