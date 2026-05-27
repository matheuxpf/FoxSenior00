// FoxSenior - Modern Frontend Controller

// Destructure invoke from global Tauri object
const { invoke } = window.__TAURI__.core;

// App State
let state = {
  arquivos: [],
  arquivoAtivo: null,
  linhas: [],
  fontes: [],
  linhaAtiva: 0,
  impressoras: [],
  impressoraPadrao: null,
};

// DOM Elements
const elements = {
  get fileList() {
    return document.getElementById("file-list");
  },
  get printerSelect() {
    return document.getElementById("printer-select");
  },
  get layoutSelect() {
    return document.getElementById("layout-select");
  },
  get alignSelect() {
    return document.getElementById("align-select");
  },
  get copiesInput() {
    return document.getElementById("copies-input");
  },
  get fontSizeInput() {
    return document.getElementById("font-size-input");
  },
  get fontDecBtn() {
    return document.getElementById("font-dec");
  },
  get fontIncBtn() {
    return document.getElementById("font-inc");
  },
  get activeFileIndicator() {
    return document.getElementById("active-file-indicator");
  },
  get textarea() {
    return document.getElementById("label-textarea");
  },
  get canvas() {
    return document.getElementById("preview-canvas");
  },
  get btnSave() {
    return document.getElementById("btn-save");
  },
  get btnPrint() {
    return document.getElementById("btn-print");
  },
  get btnNewFile() {
    return document.getElementById("btn-new-file");
  },
  get toast() {
    return document.getElementById("toast");
  },
  get searchInput() {
    return document.getElementById("search-input");
  },
  get darknessRange() {
    return document.getElementById("darkness-range");
  },
  get darknessVal() {
    return document.getElementById("darkness-val");
  },
  get chkOvertype() {
    return document.getElementById("chk-overtype");
  },
};

// Initialize Canvas lazily
let ctx = null;

// --- TOAST SYSTEM ---
let toastTimeout = null;

function showToast(message, type = "info", duration = 3000) {
  if (toastTimeout) {
    clearTimeout(toastTimeout);
  }

  elements.toast.innerText = message;

  // Reset classes and add modern styles
  elements.toast.className = "toast";
  elements.toast.classList.add(type);

  // Force a browser reflow to trigger CSS transitions correctly
  elements.toast.offsetHeight;

  toastTimeout = setTimeout(() => {
    elements.toast.classList.add("hidden");
  }, duration);
}

function setupPrinterStatusListener() {
  if (window.__TAURI__ && window.__TAURI__.event) {
    window.__TAURI__.event.listen("print-job-status", (event) => {
      const payload = event.payload;
      if (!payload) return;

      let type = "info";
      let duration = 3000;

      switch (payload.status) {
        case "SUCCESS":
          type = "success";
          duration = 4000;
          break;
        case "FAILED":
        case "OFFLINE":
        case "PAPER_OUT":
          type = "error";
          duration = 6000;
          break;
        case "PRINTING":
        case "PAUSED":
        case "TIMEOUT":
          type = "warning";
          duration = 4000;
          break;
        case "SPOOLING":
        case "ACTIVE":
        default:
          type = "info";
          duration = 3000;
          break;
      }

      showToast(payload.message, type, duration);
    });
  }
}

// --- MARGENS E DESLOCAMENTO ---
// --- INITIALIZATION ---
async function init() {
  try {
    // Restaurar preferências do LocalStorage
    const savedDarkness = localStorage.getItem("foxsenior_darkness");
    if (savedDarkness) {
      elements.darknessRange.value = savedDarkness;
      elements.darknessVal.innerText = savedDarkness;
    }

    // 1. Carregar impressoras
    await carregarImpressoras();

    // 2. Carregar arquivos de templates
    await carregarTemplates();

    // 3. Registrar Event Listeners
    setupEventListeners();

    // 4. Configurar listener de status da impressora
    setupPrinterStatusListener();

    // 5. Desenhar preview inicial vazio
    renderPreview();
  } catch (error) {
    console.error("Erro na inicialização:", error);
    showToast("Erro ao inicializar o aplicativo.", "error");
  }
}

// --- IMPRESSORAS ---
async function carregarImpressoras() {
  try {
    const lista = await invoke("listar_impressoras");
    state.impressoras = lista;

    elements.printerSelect.innerHTML = "";

    if (lista.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.text = "Nenhuma impressora encontrada";
      option.disabled = true;
      elements.printerSelect.appendChild(option);
      return;
    }

    lista.forEach((imp) => {
      const option = document.createElement("option");
      option.value = imp;
      option.text = imp;
      elements.printerSelect.appendChild(option);
    });

    // Obter impressora padrão do sistema
    const padrao = await invoke("obter_impressora_padrao");
    if (padrao && lista.includes(padrao)) {
      state.impressoraPadrao = padrao;
      elements.printerSelect.value = padrao;
    } else if (lista.length > 0) {
      elements.printerSelect.selectedIndex = 0;
    }
  } catch (err) {
    console.error("Erro ao listar impressoras:", err);
    elements.printerSelect.innerHTML =
      '<option value="">Erro ao buscar impressoras</option>';
  }
}

// --- TEMPLATES ---
async function carregarTemplates() {
  try {
    const templates = await invoke("listar_templates");
    state.arquivos = templates;
    renderizarTemplatesList();
  } catch (err) {
    console.error("Erro ao listar templates:", err);
    elements.fileList.innerHTML =
      '<li class="file-item" style="cursor: default; text-align: center;">Erro ao carregar lista</li>';
  }
}

function renderizarTemplatesList(busca = "") {
  elements.fileList.innerHTML = "";
  const termo = busca.toLowerCase().trim();

  const filtrados = state.arquivos.filter((file) =>
    file.toLowerCase().includes(termo),
  );

  if (filtrados.length === 0) {
    elements.fileList.innerHTML =
      '<li class="file-item" style="cursor: default; text-align: center;">Nenhum template encontrado</li>';
    return;
  }

  filtrados.forEach((file) => {
    const li = document.createElement("li");
    li.className = "file-item";
    if (state.arquivoAtivo === file) {
      li.classList.add("active");
    }
    li.innerText = file;
    li.title = file;
    li.addEventListener("click", () => selecionarTemplate(file, li));
    elements.fileList.appendChild(li);
  });
}

async function selecionarTemplate(nome, element) {
  // Desativar item anterior
  document
    .querySelectorAll(".file-item")
    .forEach((el) => el.classList.remove("active"));

  // Ativar item atual
  if (element) {
    element.classList.add("active");
  }
  state.arquivoAtivo = nome;
  elements.activeFileIndicator.innerText = nome;

  try {
    const data = await invoke("ler_template", { nome });
    state.linhas = data.linhas;
    state.fontes = data.fontes;

    // Montar texto no editor
    elements.textarea.value = data.linhas.join("\n");

    // Resetar cursor e linha ativa
    state.linhaAtiva = 0;
    atualizarControleFonte();
    renderPreview();

    showToast(`Template "${nome}" carregado!`, "success");
  } catch (err) {
    console.error("Erro ao ler template:", err);
    showToast("Erro ao abrir template.", "error");
  }
}

async function carregarTemplate(nome) {
  const items = document.querySelectorAll(".file-item");
  let targetEl = null;
  for (let el of items) {
    if (el.innerText.trim() === nome.trim()) {
      targetEl = el;
      break;
    }
  }
  await selecionarTemplate(nome, targetEl);
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
  // Mudanças no texto
  elements.textarea.addEventListener("input", () => {
    const linhasTexto = elements.textarea.value.split("\n");
    state.linhas = linhasTexto;

    // Sincronizar fontes para novas linhas adicionadas
    while (state.fontes.length < linhasTexto.length) {
      state.fontes.push(25); // tamanho padrão
    }
    // Truncar fontes caso linhas tenham sido removidas
    if (state.fontes.length > linhasTexto.length) {
      state.fontes = state.fontes.slice(0, linhasTexto.length);
    }

    atualizarLinhaAtiva();
    renderPreview();
  });

  // Monitorar movimento do cursor no textarea
  elements.textarea.addEventListener("keyup", atualizarLinhaAtiva);
  elements.textarea.addEventListener("click", atualizarLinhaAtiva);
  elements.textarea.addEventListener("select", atualizarLinhaAtiva);

  // Helper para aplicar fonte em múltiplas linhas selecionadas
  const aplicarFonteNasLinhasSelecionadas = (val) => {
    if (state.fontes.length === 0) return;
    const start = elements.textarea.selectionStart;
    const end = elements.textarea.selectionEnd;
    const text = elements.textarea.value;
    
    const linhaInicio = text.substring(0, start).split('\n').length - 1;
    let linhaFim = text.substring(0, end).split('\n').length - 1;
    
    if (start !== end && text.charAt(end - 1) === '\n') {
      linhaFim = Math.max(linhaInicio, linhaFim - 1);
    }

    let changed = false;
    for (let i = linhaInicio; i <= Math.min(linhaFim, state.fontes.length - 1); i++) {
      state.fontes[i] = val;
      changed = true;
    }
    if (changed) renderPreview();
  };

  // Controle de Fonte
  elements.fontSizeInput.addEventListener("change", () => {
    let val = parseInt(elements.fontSizeInput.value) || 25;
    if (val < 10) val = 10;
    if (val > 100) val = 100;
    elements.fontSizeInput.value = val;
    aplicarFonteNasLinhasSelecionadas(val);
  });

  elements.fontSizeInput.addEventListener("input", () => {
    let val = parseInt(elements.fontSizeInput.value);
    if (val >= 10 && val <= 100) {
      aplicarFonteNasLinhasSelecionadas(val);
    }
  });

  elements.fontDecBtn.addEventListener("click", () => {
    let val = parseInt(elements.fontSizeInput.value) || 25;
    if (val > 10) {
      val--;
      elements.fontSizeInput.value = val;
      aplicarFonteNasLinhasSelecionadas(val);
    }
  });

  elements.fontIncBtn.addEventListener("click", () => {
    let val = parseInt(elements.fontSizeInput.value) || 25;
    if (val < 100) {
      val++;
      elements.fontSizeInput.value = val;
      aplicarFonteNasLinhasSelecionadas(val);
    }
  });

  // Layout change redraw
  elements.layoutSelect.addEventListener("change", () => {
    const layout = elements.layoutSelect.value;
    if (layout === "1") {
      elements.alignSelect.value = "L";
    } else {
      elements.alignSelect.value = "C";
    }
    renderPreview();
  });

  // Alinhamento change redraw
  elements.alignSelect.addEventListener("change", renderPreview);

  // Salvar
  elements.btnSave.addEventListener("click", executarSalvar);

  // Imprimir
  elements.btnPrint.addEventListener("click", executarImprimir);

  // Novo Arquivo
  elements.btnNewFile.addEventListener("click", executarNovoArquivo);

  // Filtro de pesquisa
  elements.searchInput.addEventListener("input", (e) => {
    renderizarTemplatesList(e.target.value);
  });

  // Escuridão / Contraste
  elements.darknessRange.addEventListener("input", (e) => {
    elements.darknessVal.innerText = e.target.value;
    localStorage.setItem("foxsenior_darkness", e.target.value);
  });

  // Sobrescrever '_' ao digitar (Modo preenchimento de template)
  elements.textarea.addEventListener("keypress", (e) => {
    if (elements.chkOvertype.checked) {
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const start = elements.textarea.selectionStart;
        const end = elements.textarea.selectionEnd;

        if (start === end && start < elements.textarea.value.length) {
          const charAhead = elements.textarea.value.charAt(start);
          if (charAhead === "_") {
            e.preventDefault();
            const text = elements.textarea.value;
            elements.textarea.value =
              text.substring(0, start) + e.key + text.substring(start + 1);
            elements.textarea.selectionStart = elements.textarea.selectionEnd =
              start + 1;

            // Forçar disparador de input para atualizar visual e preview
            elements.textarea.dispatchEvent(new Event("input"));
          }
        }
      }
    }
  });

  // Navegação na lista de templates usando as setas do teclado
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // Ignora se o foco estiver em campos onde as setas são usadas para navegação interna do texto/valores
      if (
        document.activeElement === elements.textarea ||
        document.activeElement === elements.copiesInput ||
        document.activeElement === elements.fontSizeInput ||
        document.activeElement === elements.darknessRange
      ) {
        return;
      }

      const items = Array.from(elements.fileList.querySelectorAll(".file-item"));
      if (items.length === 0) return;

      e.preventDefault(); // Evita a rolagem padrão da barra lateral/tela

      let currentIndex = items.findIndex((el) => el.classList.contains("active"));

      if (e.key === "ArrowDown") {
        currentIndex = currentIndex + 1 < items.length ? currentIndex + 1 : 0;
      } else if (e.key === "ArrowUp") {
        currentIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
      }

      const targetItem = items[currentIndex];
      if (targetItem) {
        const nome = targetItem.innerText;
        selecionarTemplate(nome, targetItem);
        // Faz a rolagem automática para manter o item selecionado visível
        targetItem.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  });
}

// --- CONTROLES DE WYSIWYG ---
function atualizarLinhaAtiva() {
  const selectionStart = elements.textarea.selectionStart;
  const textoAteCursor = elements.textarea.value.substring(0, selectionStart);
  const linhaIdx = textoAteCursor.split("\n").length - 1;

  if (state.linhaAtiva !== linhaIdx) {
    state.linhaAtiva = linhaIdx;
    atualizarControleFonte();
  }
}

function atualizarControleFonte() {
  const fonte = state.fontes[state.linhaAtiva] || 25;
  elements.fontSizeInput.value = fonte;
}

// --- SALVAMENTO ---
async function executarSalvar() {
  if (!state.arquivoAtivo) {
    showToast("Por favor, selecione um template primeiro!", "warning");
    return;
  }

  // Garantir que as linhas do state estão sincronizadas com o textarea antes de enviar
  state.linhas = elements.textarea.value.split("\n");

  try {
    await invoke("salvar_template", {
      nome: state.arquivoAtivo,
      linhas: state.linhas,
      fontes: state.fontes,
    });
    showToast("Alterações salvas com sucesso! 💾", "success");
  } catch (err) {
    console.error("Erro ao salvar:", err);
    showToast("Falha ao salvar as alterações.", "error");
  }
}

async function executarNovoArquivo() {
  let nome = prompt("Digite o nome da nova etiqueta (ex: limao):");
  if (nome === null) return;

  nome = nome.trim();
  if (!nome) {
    showToast("Nome do arquivo não pode ser vazio!", "warning");
    return;
  }

  // Remover caracteres inválidos para nomes de arquivos
  nome = nome.replace(/[\/\\:\*\?"<>\|]/g, "");
  if (!nome) {
    showToast("Nome do arquivo inválido!", "warning");
    return;
  }

  // Garantir a extensão .txt
  if (
    !nome.toLowerCase().endsWith(".txt") &&
    !nome.toLowerCase().endsWith(".out")
  ) {
    nome += ".txt";
  }

  // Verificar duplicado
  const jaExiste = state.arquivos.some(
    (a) => a.toLowerCase() === nome.toLowerCase(),
  );
  if (jaExiste) {
    showToast(`O arquivo "${nome}" já existe! Carregando-o.`, "warning");
    await carregarTemplate(nome);
    return;
  }

  try {
    const defaultLinhas = ["NOVO TEMPLATE"];
    const defaultFontes = [25];

    await invoke("salvar_template", {
      nome,
      linhas: defaultLinhas,
      fontes: defaultFontes,
    });

    showToast(`Etiqueta "${nome}" criada! 📄`, "success");

    // Recarregar lista e carregar a nova etiqueta
    await carregarTemplates();
    await carregarTemplate(nome);
  } catch (err) {
    console.error("Erro ao criar etiqueta:", err);
    showToast("Falha ao criar nova etiqueta.", "error");
  }
}

// --- WORD WRAP UTILITY ---
function wrapText(ctx, text, maxWidth) {
  if (!text) return [""];
  const words = text.split(" ");
  const lines = [];
  let currentLine = "";

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const wordWidth = ctx.measureText(word).width;

    if (wordWidth > maxWidth) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = "";
      }
      let chunk = "";
      for (let j = 0; j < word.length; j++) {
        const testChunk = chunk + word[j];
        if (ctx.measureText(testChunk).width > maxWidth) {
          if (chunk) lines.push(chunk);
          chunk = word[j];
        } else {
          chunk = testChunk;
        }
      }
      currentLine = chunk;
    } else {
      const testLine = currentLine ? currentLine + " " + word : word;
      if (ctx.measureText(testLine).width > maxWidth) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

// --- IMPRESSÃO ---
async function executarImprimir() {
  if (!state.arquivoAtivo) {
    showToast("Selecione um template para imprimir!", "warning");
    return;
  }

  const impressora = elements.printerSelect.value;
  if (!impressora) {
    showToast("Selecione uma impressora válida!", "warning");
    return;
  }

  const copias = parseInt(elements.copiesInput.value) || 1;
  const layout = elements.layoutSelect.value;
  const escuridao = parseInt(elements.darknessRange.value) || 15;

  const cols = parseInt(layout) || 1;
  const totalWidth = 290;
  const gap = 10;
  const colWidth =
    cols > 1 ? (totalWidth - (cols - 1) * gap) / cols : totalWidth;
  const maxTextWidth = cols > 1 ? colWidth - 5 : totalWidth - 10;

  // Pré-envelopamento de linhas para garantir que o layout impresso coincida com o preview
  const wrappedLinhas = [];
  const wrappedFontes = [];

  state.linhas.forEach((linha, i) => {
    const t = linha.trim();
    const f = state.fontes[i] || 25;
    if (!t) {
      wrappedLinhas.push("");
      wrappedFontes.push(f);
      return;
    }

    const canvasFont = Math.max(8, f - 7);
    ctx.font = `700 ${canvasFont}px 'Outfit', sans-serif`;

    const wrapped = wrapText(ctx, t, maxTextWidth);
    wrapped.forEach((wrappedLine) => {
      wrappedLinhas.push(wrappedLine);
      wrappedFontes.push(f);
    });
  });

  const deslocamentoX = layout === "1" ? 40 : 0;
  const deslocamentoY = layout === "1" ? 60 : 95;

  try {
    showToast("Preparando trabalho de impressão...", "info", 1500);
    await invoke("imprimir_etiqueta", {
      impressora,
      linhas: wrappedLinhas,
      fontes: wrappedFontes,
      copias,
      layout,
      escuridao,
      alinhamento: elements.alignSelect.value,
      deslocamentoY,
      deslocamentoX,
    });
  } catch (err) {
    console.error("Erro ao imprimir:", err);
    showToast(`Erro na impressão: ${err}`, "error");
  }
}

// --- RENDERIZAR PRÉ-VISUALIZAÇÃO (CANVAS) ---
function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawBarcodeMockup(ctx, x, y, width, height, codeString) {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, width, height);

  ctx.fillStyle = "#000000";
  const numStripes = 29;
  const stripeWidth = width / numStripes;

  for (let s = 0; s < numStripes; s++) {
    const isStripe = s % 3 !== 0 && s % 9 !== 5;
    if (isStripe) {
      const w = s % 5 === 0 ? stripeWidth * 1.5 : stripeWidth * 0.8;
      ctx.fillRect(x + s * stripeWidth, y + 2, w, height - 14);
    }
  }

  ctx.fillStyle = "#000000";
  ctx.font = "600 8.5px monospace";
  ctx.textAlign = "center";
  ctx.fillText(codeString || "7896071016186", x + width / 2, y + height - 2);
  ctx.restore();
}

function drawQRCodeMockup(ctx, x, y, size, text) {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, size, size);

  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 1.5, y + 1.5, size - 3, size - 3);

  ctx.fillStyle = "#000000";
  const sq = Math.floor(size * 0.26);

  // Top-left
  ctx.fillRect(x + 3, y + 3, sq, sq);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + 4.5, y + 4.5, sq - 3, sq - 3);
  ctx.fillStyle = "#000000";
  ctx.fillRect(x + 5.5, y + 5.5, sq - 5, sq - 5);

  // Top-right
  ctx.fillRect(x + size - 3 - sq, y + 3, sq, sq);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + size - 1.5 - sq, y + 4.5, sq - 3, sq - 3);
  ctx.fillStyle = "#000000";
  ctx.fillRect(x + size - 0.5 - sq, y + 5.5, sq - 5, sq - 5);

  // Bottom-left
  ctx.fillRect(x + 3, y + size - 3 - sq, sq, sq);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + 4.5, y + size - 1.5 - sq, sq - 3, sq - 3);
  ctx.fillStyle = "#000000";
  ctx.fillRect(x + 5.5, y + size - 0.5 - sq, sq - 5, sq - 5);

  ctx.fillStyle = "#000000";
  const noiseSize = 2;
  const startNoiseX = x + sq + 5;
  const endNoiseX = x + size - 3;
  const startNoiseY = y + 3;
  const endNoiseY = y + size - 3;

  for (let nx = startNoiseX; nx < endNoiseX; nx += noiseSize + 1) {
    for (let ny = startNoiseY; ny < endNoiseY; ny += noiseSize + 1) {
      if (nx < x + sq + 5 && ny > y + size - sq - 5) continue;
      if (nx > x + size - sq - 5 && ny < y + sq + 5) continue;
      if (Math.random() > 0.45) {
        ctx.fillRect(nx, ny, noiseSize, noiseSize);
      }
    }
  }
  ctx.restore();
}

function renderPreview() {
  if (!ctx && elements.canvas) {
    ctx = elements.canvas.getContext("2d");
  }
  if (!ctx) return;

  // O preview agora vai simular a largura total da cabeça de impressão Zebra (832 pontos)
  // para ser 100% fiel à impressão real.
  const logicalWidth = 832;
  const logicalHeight = 832;

  // Garantir que o canvas tenha a resolução interna correta
  if (elements.canvas.width !== logicalWidth) {
    elements.canvas.width = logicalWidth;
    elements.canvas.height = logicalHeight;
  }

  const w = logicalWidth;
  const h = logicalHeight;

  ctx.fillStyle = "#f1f5f9";
  ctx.fillRect(0, 0, w, h);

  const layout = elements.layoutSelect.value;
  const cols = parseInt(layout) || 1;

  const deslocamentoX = layout === "1" ? 40 : 0;
  const deslocamentoY = layout === "1" ? 60 : 95;

  // Configurações de layout sincronizadas com o Backend (Rust)
  let totalWidth, gap, xOffset;
  if (cols === 2) {
    totalWidth = 820;
    gap = 20;
    xOffset = deslocamentoX;
  } else {
    totalWidth = 832;
    gap = 0;
    xOffset = deslocamentoX;
  }

  const colWidth = (totalWidth - (cols - 1) * gap) / cols;
  const padding = 10;

  // 1. Desenhar fundo das etiquetas
  for (let c = 0; c < cols; c++) {
    const labelX = xOffset + c * (colWidth + gap);
    const labelY = 0;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(labelX, labelY, colWidth, h);

    // Simulação do layout de refresco (Faixa Verde)
    if (layout === "2_refresco") {
      ctx.fillStyle = "#22c55e";
      ctx.fillRect(labelX, labelY, colWidth, 75);

      ctx.fillStyle = "#ffffff";
      ctx.font = "700 30px 'Outfit', sans-serif"; // Fonte maior para o cabeçalho no preview HD
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("SUCO / REFRESCO", labelX + colWidth / 2, labelY + 38);
    }

    // Borda da etiqueta
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 2;
    ctx.strokeRect(labelX, labelY, colWidth, h);
  }

  if (state.linhas.length === 0) return;

  ctx.textBaseline = "top";
  const alinhamento = elements.alignSelect.value;
  let yOffset = deslocamentoY;

  state.linhas.forEach((linha, idx) => {
    const t = linha.trim();
    const f = state.fontes[idx] || 25;

    // 1. QR Code
    if (t.startsWith("[QR:") && t.endsWith("]")) {
      const qrSize = 100;
      for (let c = 0; c < cols; c++) {
        const labelX = xOffset + c * (colWidth + gap);
        drawQRCodeMockup(
          ctx,
          labelX + (colWidth - qrSize) / 2,
          yOffset,
          qrSize,
          "",
        );
      }
      yOffset += qrSize + 15;
      return;
    }

    // 2. Barcode
    const isBarcode =
      (t.length >= 8 && t.length <= 13 && /^\d+$/.test(t)) ||
      (t.startsWith("[EAN:") && t.endsWith("]"));
    if (isBarcode) {
      const bWidth = colWidth - 40;
      const bHeight = 80;
      for (let c = 0; c < cols; c++) {
        const labelX = xOffset + c * (colWidth + gap);
        drawBarcodeMockup(
          ctx,
          labelX + (colWidth - bWidth) / 2,
          yOffset,
          bWidth,
          bHeight,
          "",
        );
      }
      yOffset += bHeight + 15;
      return;
    }

    // 3. Texto Normal (Sincronizado com a escala real)
    const canvasFont = f;
    const lineSpacing = Math.round(canvasFont * 1.15);

    if (!t) {
      yOffset += lineSpacing;
      return;
    }

    ctx.font = `700 ${canvasFont}px 'Outfit', sans-serif`;

    // O wrapping no preview agora usa a largura real da coluna
    const maxTextWidth = colWidth - (alinhamento === "L" ? 20 : 10);
    const wrapped = wrapText(ctx, t, maxTextWidth);

    wrapped.forEach((wrappedLine) => {
      for (let c = 0; c < cols; c++) {
        const labelX = xOffset + c * (colWidth + gap);

        const inHeader = layout === "2_refresco" && yOffset <= 75;
        ctx.fillStyle = inHeader ? "#ffffff" : "#000000";

        if (alinhamento === "C") {
          ctx.textAlign = "center";
          ctx.fillText(wrappedLine, labelX + colWidth / 2, yOffset);
        } else {
          ctx.textAlign = "left";
          ctx.fillText(wrappedLine, labelX + 10, yOffset);
        }
      }
      yOffset += lineSpacing;
    });
  });
}

// Run Initialization when DOM is ready
document.addEventListener("DOMContentLoaded", init);
