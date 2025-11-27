const VAT = 1.23;

// pomocnicze
function getMarginKey(name) {
    return "margin:" + encodeURIComponent(name);
}
function getMargin(name) {
    const v = localStorage.getItem(getMarginKey(name));
    return v ? parseFloat(v) : 0;
}
function setMargin(name, value) {
    localStorage.setItem(getMarginKey(name), value);
}

// formatowanie
function formatPrice(v) {
    if (v === null || v === undefined) return 'brak';
    return v.toFixed(3).replace('.', ',') + " zł";
}

// ładowanie JSON
async function loadJSON(url) {
    const res = await fetch(url + "?t=" + Date.now());
    if (!res.ok) throw new Error("Błąd pobierania " + url);
    return await res.json();
}

// render listy produktów
function renderList(prices) {
    const container = document.getElementById("prices-container");
    container.innerHTML = "";

    for (const name of Object.keys(prices)) {
        const item = prices[name];
        const perLiterNetto = item.raw ? (item.raw / 1000) : null;
        const perLiterBrutto = perLiterNetto ? perLiterNetto * VAT : null;

        const margin = getMargin(name);
        const finalPrice = perLiterBrutto ? perLiterBrutto + margin / 100 : null;

        const div = document.createElement("div");
        div.className = "product-box";

        div.innerHTML = `
            <h3>${name}</h3>
            <p>Netto / litr: <strong>${perLiterNetto ? formatPrice(perLiterNetto) : "brak"}</strong></p>
            <p>Brutto / litr: <strong>${perLiterBrutto ? formatPrice(perLiterBrutto) : "brak"}</strong></p>

            <label>Marża (gr): <input type="number" value="${margin}" class="marza-input"></label>

            <p>Cena końcowa: <strong>${finalPrice ? formatPrice(finalPrice) : "brak"}</strong></p>
        `;

        const input = div.querySelector(".marza-input");
        input.addEventListener("change", () => {
            setMargin(name, parseFloat(input.value || "0"));
            renderList(prices);
        });

        container.appendChild(div);
    }
}

// prosty wykres z history.json
function renderChart(history) {
    const chart = document.getElementById("chart");
    chart.innerHTML = "";

    if (!history || !Array.isArray(history) || history.length === 0) {
        chart.innerText = "Brak danych historycznych.";
        return;
    }

    const first = history[history.length - 1].prices;
    const productName = Object.keys(first)[0];
    if (!productName) {
        chart.innerText = "Brak produktów w historii.";
        return;
    }

    const points = history
        .map(h => ({
            t: new Date(h.fetched_at),
            v: h.prices[productName]?.gross || null
        }))
        .filter(p => p.v !== null);

    if (points.length < 2) {
        chart.innerText = "Za mało danych do wykresu.";
        return;
    }

    // rysowanie (minimalistyczne)
    const w = chart.clientWidth;
    const h = chart.clientHeight;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
    svg.style.display = "block";

    const minV = Math.min(...points.map(p => p.v));
    const maxV = Math.max(...points.map(p => p.v));

    const path = points.map((p, i) => {
        const x = (i / (points.length - 1)) * (w - 20) + 10;
        const y = h - ((p.v - minV) / (maxV - minV)) * (h - 20) - 10;
        return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    }).join(" ");

    const pth = document.createElementNS(svg.namespaceURI, "path");
    pth.setAttribute("d", path);
    pth.setAttribute("fill", "none");
    pth.setAttribute("stroke", "#0b69ff");
    pth.setAttribute("stroke-width", "2");

    svg.appendChild(pth);
    chart.appendChild(svg);
}

// inicjalizacja
async function init() {
    try {
        const pricesData = await loadJSON("prices.json");
        renderList(pricesData.prices);

        const history = await loadJSON("history.json");
        renderChart(history);

    } catch (err) {
        console.error(err);
        document.getElementById("prices-container").innerText = "Błąd wczytywania danych.";
    }
}

document.addEventListener("DOMContentLoaded", init);