const SUPABASE_URL = 'https://otdwyajhwgenykjdeynv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_KhvLPkG-7NYLRlEFUhnkJw_-HEFJN1g';


const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CATEGORIAS = [
  { valor: 'bebida', titulo: 'Bebidas' },
  { valor: 'cerveja', titulo: 'Cervejas' },
  { valor: 'vinho', titulo: 'Vinhos' },
];

let categoriaAtiva = 'bebida';
let produtosCache = [];

// ------------------------------------------------------------
// Guarda de sessão: sem login, volta pra tela inicial
// ------------------------------------------------------------
async function iniciar() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data.session) {
    window.location.href = 'index.html';
    return;
  }
  await carregarProdutos();
  await carregarMeusDados(data.session);
  await carregarPedidos();
}

document.getElementById('sair').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  window.location.href = 'index.html';
});

// ------------------------------------------------------------
// Menu hambúrguer e troca de telas
// ------------------------------------------------------------
const menu = document.getElementById('menu');
const overlay = document.getElementById('overlay');
const botaoAbrir = document.getElementById('abrir-menu');

function abrirMenu() {
  menu.classList.add('aberto');
  overlay.classList.add('aberto');
  menu.setAttribute('aria-hidden', 'false');
  botaoAbrir.setAttribute('aria-expanded', 'true');
}

function fecharMenu() {
  menu.classList.remove('aberto');
  overlay.classList.remove('aberto');
  menu.setAttribute('aria-hidden', 'true');
  botaoAbrir.setAttribute('aria-expanded', 'false');
}

function mostrarView(nome) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('ativa', v.id === `view-${nome}`));
  document.querySelectorAll('.menu-item[data-view]').forEach((i) => i.classList.toggle('ativa', i.dataset.view === nome));
  fecharMenu();
  window.scrollTo(0, 0);
  // Recarrega pra pegar contagens novas que chegaram enquanto a página estava aberta
  if (nome === 'pedido') carregarPedidos();
  if (nome === 'alertas') carregarProdutos();
}

botaoAbrir.addEventListener('click', abrirMenu);
document.getElementById('fechar-menu').addEventListener('click', fecharMenu);
overlay.addEventListener('click', fecharMenu);
document.querySelectorAll('.menu-item[data-view]').forEach((item) => {
  item.addEventListener('click', () => mostrarView(item.dataset.view));
});

function atualizarBadges(qtd) {
  ['badge-menu', 'badge-alertas'].forEach((id) => {
    const el = document.getElementById(id);
    el.textContent = qtd;
    el.hidden = qtd === 0;
  });
}

// ------------------------------------------------------------
// Carrega produtos e desenha alertas + lista da categoria ativa
// ------------------------------------------------------------
async function carregarProdutos() {
  const { data, error } = await supabaseClient
    .from('produtos')
    .select('id, nome, codigo_interno, categoria, unidade, unidades_por_pacote, quantidade_estoque, media_semanal, quantidade_alerta')
    .eq('ativo', true)
    .order('nome');

  if (error) {
    document.getElementById('lista-produtos').innerHTML = `<p class="sem-alerta">Erro ao carregar produtos: ${error.message}</p>`;
    return;
  }

  produtosCache = data || [];
  desenharAlertas();
  desenharTabsCategoria();
  desenharListaProdutos();
}

function desenharAlertas() {
  const container = document.getElementById('alertas');
  const emAlerta = produtosCache.filter(
    (p) => p.quantidade_alerta != null && p.quantidade_estoque <= p.quantidade_alerta
  );
  atualizarBadges(emAlerta.length);

  if (emAlerta.length === 0) {
    container.innerHTML = '<p class="sem-alerta">Nenhum item com estoque baixo agora. 👍</p>';
    return;
  }

  container.innerHTML = emAlerta
    .map(
      (p) => `
    <div class="alerta-card">
      <div class="nome">${p.nome}</div>
      <div class="estoque">Estoque atual: ${p.quantidade_estoque} ${p.unidade} · alerta em ${p.quantidade_alerta}</div>
      <div class="alerta-linha">
        <label>Aumentar média semanal pra</label>
        <input type="number" step="1" min="0" value="${p.media_semanal ?? ''}" data-alerta-media="${p.id}">
        <button data-alerta-salvar="${p.id}">Salvar</button>
      </div>
    </div>`
    )
    .join('');

  container.querySelectorAll('[data-alerta-salvar]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.alertaSalvar;
      const input = container.querySelector(`[data-alerta-media="${id}"]`);
      const valor = input.value === '' ? null : parseFloat(input.value);
      await salvarProduto(id, { media_semanal: valor });
      await carregarProdutos();
    });
  });
}

function desenharTabsCategoria() {
  const container = document.getElementById('tabs-categoria');
  container.innerHTML = CATEGORIAS.map(
    (c) => `<button class="tab-cat ${c.valor === categoriaAtiva ? 'ativa' : ''}" data-cat="${c.valor}">${c.titulo}</button>`
  ).join('');

  container.querySelectorAll('.tab-cat').forEach((btn) => {
    btn.addEventListener('click', () => {
      categoriaAtiva = btn.dataset.cat;
      desenharTabsCategoria();
      desenharListaProdutos();
    });
  });
}

function desenharListaProdutos() {
  const container = document.getElementById('lista-produtos');
  const itens = produtosCache.filter((p) => p.categoria === categoriaAtiva);

  if (itens.length === 0) {
    container.innerHTML = '<p class="sem-alerta">Nenhum produto cadastrado nessa categoria.</p>';
    return;
  }

  container.innerHTML = itens
    .map((p) => {
      const usaPacote = p.categoria !== 'vinho';
      const rotuloMedia = usaPacote ? 'Média semanal (pacotes)' : 'Média semanal (garrafas)';
      const campoPacote = usaPacote ? `
        <div class="campo-mini">
          <label>Unid. por pacote</label>
          <input type="number" step="1" min="1" value="${p.unidades_por_pacote ?? ''}" data-pacote="${p.id}" placeholder="ex: 12">
        </div>` : '';

      return `
    <div class="produto-card">
      <div class="topo">
        <span class="nome">${p.nome}</span>
        <span class="codigo">${p.codigo_interno || ''}</span>
      </div>
      <div class="estoque-atual">Estoque atual: ${p.quantidade_estoque} ${p.unidade}</div>
      <div class="campos-produto">
        <div class="campo-mini">
          <label>${rotuloMedia}</label>
          <input type="number" step="1" min="0" value="${p.media_semanal ?? ''}" data-media="${p.id}" placeholder="—">
        </div>
        <div class="campo-mini">
          <label>Alerta em (unidades)</label>
          <input type="number" step="1" min="0" value="${p.quantidade_alerta ?? ''}" data-alerta="${p.id}" placeholder="—">
        </div>
        ${campoPacote}
      </div>
      <button class="salvar-produto" data-salvar="${p.id}">Salvar</button>
    </div>`;
    })
    .join('');

  container.querySelectorAll('[data-salvar]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.salvar;
      const media = container.querySelector(`[data-media="${id}"]`).value;
      const alerta = container.querySelector(`[data-alerta="${id}"]`).value;
      const campoPacoteEl = container.querySelector(`[data-pacote="${id}"]`);
      const campos = {
        media_semanal: media === '' ? null : parseFloat(media),
        quantidade_alerta: alerta === '' ? null : parseFloat(alerta),
      };
      if (campoPacoteEl) {
        campos.unidades_por_pacote = campoPacoteEl.value === '' ? null : parseFloat(campoPacoteEl.value);
      }
      await salvarProduto(id, campos);
      btn.textContent = 'Salvo ✓';
      btn.classList.add('salvo');
      setTimeout(() => { btn.textContent = 'Salvar'; btn.classList.remove('salvo'); }, 1500);
    });
  });
}

async function salvarProduto(id, campos) {
  const { error } = await supabaseClient.from('produtos').update(campos).eq('id', id);
  if (error) console.error('[dashboard] Erro ao salvar produto:', error);
}

// ------------------------------------------------------------
// Meus dados (nome, telefone) + esconder convite se não for gestor
// ------------------------------------------------------------
let sessaoAtual = null;

async function carregarMeusDados(session) {
  sessaoAtual = session;
  const { data: meuUsuario } = await supabaseClient
    .from('usuarios_app')
    .select('nome, papel, telefone_whatsapp')
    .eq('id', session.user.id)
    .maybeSingle();

  if (!meuUsuario) return;

  document.getElementById('meu-nome').value = meuUsuario.nome || '';
  document.getElementById('meu-telefone').value = meuUsuario.telefone_whatsapp || '';

  if (meuUsuario.papel !== 'gestor') {
    document.getElementById('menu-convidar').style.display = 'none';
  }
}

document.getElementById('salvar-meus-dados').addEventListener('click', async (e) => {
  const btn = e.target;
  const telefone = document.getElementById('meu-telefone').value.replace(/\D/g, '');
  const { error } = await supabaseClient
    .from('usuarios_app')
    .update({ telefone_whatsapp: telefone })
    .eq('id', sessaoAtual.user.id);

  btn.textContent = error ? 'Erro ao salvar' : 'Salvo ✓';
  if (!error) btn.classList.add('salvo');
  setTimeout(() => { btn.textContent = 'Salvar'; btn.classList.remove('salvo'); }, 1500);
});

// ------------------------------------------------------------
// Convidar novo usuário
// ------------------------------------------------------------
document.getElementById('enviar-convite').addEventListener('click', async () => {
  const mensagem = document.getElementById('convite-mensagem');
  mensagem.textContent = 'Enviando...';

  const nome = document.getElementById('convite-nome').value;
  const email = document.getElementById('convite-email').value;
  const papel = document.getElementById('convite-papel').value;
  const telefone_whatsapp = document.getElementById('convite-telefone').value.replace(/\D/g, '') || null;

  const resposta = await fetch('api/convidar-usuario', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessaoAtual.access_token}`,
    },
    body: JSON.stringify({ nome, email, papel, telefone_whatsapp }),
  });
  const resultado = await resposta.json();

  if (!resposta.ok) {
    mensagem.textContent = 'Erro: ' + resultado.error;
    return;
  }
  mensagem.textContent = `Convite enviado pra ${email}!`;
  document.getElementById('convite-nome').value = '';
  document.getElementById('convite-email').value = '';
  document.getElementById('convite-telefone').value = '';
});

// ------------------------------------------------------------
// Adicionar novo produto
// ------------------------------------------------------------
const formNovo = document.getElementById('form-novo-produto');
const botaoAbrirNovo = document.getElementById('abrir-novo-produto');
const mensagemNovo = document.getElementById('novo-mensagem');

function mostrarMensagemNovo(texto, tipo) {
  mensagemNovo.textContent = texto;
  mensagemNovo.className = `mensagem-form ${tipo || ''}`;
}

function limparFormNovo() {
  ['novo-nome', 'novo-codigo', 'novo-estoque', 'novo-media', 'novo-alerta', 'novo-pacote'].forEach((id) => {
    document.getElementById(id).value = '';
  });
  document.getElementById('novo-unidade').value = 'un';
  mostrarMensagemNovo('');
}

function abrirFormNovo() {
  limparFormNovo();
  // Já vem com a categoria da aba que está aberta
  document.getElementById('novo-categoria').value = categoriaAtiva;
  formNovo.hidden = false;
  botaoAbrirNovo.hidden = true;
  document.getElementById('novo-nome').focus();
}

function fecharFormNovo() {
  formNovo.hidden = true;
  botaoAbrirNovo.hidden = false;
}

function numeroOuNulo(valor) {
  return valor === '' ? null : parseFloat(valor);
}

botaoAbrirNovo.addEventListener('click', abrirFormNovo);
document.getElementById('cancelar-novo-produto').addEventListener('click', fecharFormNovo);

document.getElementById('salvar-novo-produto').addEventListener('click', async () => {
  const nome = document.getElementById('novo-nome').value.trim();
  if (!nome) {
    mostrarMensagemNovo('Preencha o nome do produto.', 'erro');
    return;
  }

  const categoria = document.getElementById('novo-categoria').value;
  const novoProduto = {
    nome,
    categoria,
    unidade: document.getElementById('novo-unidade').value,
    codigo_interno: document.getElementById('novo-codigo').value.trim() || null,
    quantidade_estoque: numeroOuNulo(document.getElementById('novo-estoque').value) ?? 0,
    media_semanal: numeroOuNulo(document.getElementById('novo-media').value),
    quantidade_alerta: numeroOuNulo(document.getElementById('novo-alerta').value),
    unidades_por_pacote: numeroOuNulo(document.getElementById('novo-pacote').value),
  };

  mostrarMensagemNovo('Salvando…');
  const { error } = await supabaseClient.from('produtos').insert(novoProduto);

  if (error) {
    // 23505 = violação de unicidade (código interno repetido)
    const texto = error.code === '23505'
      ? 'Já existe um produto com esse código interno.'
      : 'Erro ao salvar: ' + error.message;
    mostrarMensagemNovo(texto, 'erro');
    return;
  }

  // Mostra o produto novo na aba da categoria que ele foi cadastrado
  categoriaAtiva = categoria;
  await carregarProdutos();
  fecharFormNovo();
});

// ------------------------------------------------------------
// Pedido da semana (checklist de compra)
// ------------------------------------------------------------
const ORDEM_CATEGORIA = { bebida: 0, cerveja: 1, vinho: 2 };
const NOME_CATEGORIA = { bebida: 'Bebidas', cerveja: 'Cervejas', vinho: 'Vinhos' };

let pedidoSelecionadoId = null;
let itensPedidoAtual = [];

function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatarData(iso) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Entra na lista de compra: o que tem sugestão de pedido, o que está em alerta
// e o que já foi comprado. O resto vai pra seção recolhida "sem necessidade".
function itemEmAlerta(item) {
  const alerta = item.produtos.quantidade_alerta;
  return alerta != null && item.quantidade_contada <= alerta;
}

function precisaPedir(item) {
  return item.comprado || (item.quantidade_sugerida ?? 0) > 0 || itemEmAlerta(item);
}

function ordenarItens(a, b) {
  return (a.comprado - b.comprado)
    || (ORDEM_CATEGORIA[a.produtos.categoria] - ORDEM_CATEGORIA[b.produtos.categoria])
    || a.produtos.nome.localeCompare(b.produtos.nome, 'pt-BR');
}

async function carregarPedidos() {
  const container = document.getElementById('lista-pedido');
  const { data, error } = await supabaseClient
    .from('pedidos')
    .select('id, criado_em, responsaveis(nome, telefone)')
    .order('criado_em', { ascending: false })
    .limit(8);

  if (error) {
    container.innerHTML = `<p class="sem-alerta">Erro ao carregar pedidos: ${esc(error.message)}</p>`;
    return;
  }

  const pedidos = data || [];
  const wrap = document.getElementById('seletor-pedido-wrap');
  const seletor = document.getElementById('seletor-pedido');

  if (pedidos.length === 0) {
    wrap.hidden = true;
    document.getElementById('resumo-pedido').textContent = '';
    document.getElementById('copiar-pedido').hidden = true;
    document.getElementById('sem-necessidade').hidden = true;
    container.innerHTML = '<p class="sem-alerta">Nenhuma contagem finalizada ainda. Quando alguém finalizar uma contagem pelo WhatsApp, o pedido aparece aqui.</p>';
    return;
  }

  seletor.innerHTML = pedidos.map((p) => {
    const quem = p.responsaveis?.nome || p.responsaveis?.telefone || 'contagem';
    return `<option value="${p.id}">${formatarData(p.criado_em)} · ${esc(quem)}</option>`;
  }).join('');
  wrap.hidden = pedidos.length < 2;

  if (!pedidoSelecionadoId || !pedidos.some((p) => p.id === pedidoSelecionadoId)) {
    pedidoSelecionadoId = pedidos[0].id;
  }
  seletor.value = pedidoSelecionadoId;
  await desenharPedido(pedidoSelecionadoId);
}

async function desenharPedido(pedidoId) {
  const container = document.getElementById('lista-pedido');
  const { data, error } = await supabaseClient
    .from('itens_pedido')
    .select('id, quantidade_contada, quantidade_sugerida, quantidade, comprado, comprado_em, produtos(id, nome, unidade, categoria, codigo_interno, quantidade_alerta, unidades_por_pacote)')
    .eq('pedido_id', pedidoId);

  if (error) {
    container.innerHTML = `<p class="sem-alerta">Erro ao carregar itens: ${esc(error.message)}</p>`;
    return;
  }

  itensPedidoAtual = (data || []).filter((i) => i.produtos);
  const paraPedir = itensPedidoAtual.filter(precisaPedir).sort(ordenarItens);
  const semNecessidade = itensPedidoAtual.filter((i) => !precisaPedir(i)).sort(ordenarItens);

  const pendentes = paraPedir.filter((i) => !i.comprado).length;
  const comprados = paraPedir.length - pendentes;
  document.getElementById('resumo-pedido').textContent =
    `${pendentes} ${pendentes === 1 ? 'item pendente' : 'itens pendentes'} · ${comprados} ${comprados === 1 ? 'comprado' : 'comprados'}`;
  document.getElementById('copiar-pedido').hidden = pendentes === 0;

  container.innerHTML = paraPedir.length
    ? paraPedir.map(cardItemPedido).join('')
    : '<p class="sem-alerta">Nenhum item precisa ser pedido nessa contagem. 👍</p>';

  container.querySelectorAll('[data-comprar]').forEach((btn) => {
    btn.addEventListener('click', () => marcarComprado(btn));
  });

  const detalhes = document.getElementById('sem-necessidade');
  if (semNecessidade.length > 0) {
    const n = semNecessidade.length;
    document.getElementById('sem-necessidade-titulo').textContent =
      `${n} ${n === 1 ? 'item contado' : 'itens contados'} sem necessidade de pedido`;
    document.getElementById('lista-sem-necessidade').innerHTML = semNecessidade
      .map((i) => `<li>${esc(i.produtos.nome)}: ${i.quantidade_contada} ${esc(i.produtos.unidade)}</li>`)
      .join('');
    detalhes.hidden = false;
  } else {
    detalhes.hidden = true;
  }
}

function cardItemPedido(item) {
  const p = item.produtos;
  const tag = itemEmAlerta(item) ? '<span class="tag-alerta">ALERTA</span>' : '';
  const usaPacote = p.categoria !== 'vinho' && p.unidades_por_pacote;

  let sugestao = ' · Sem média definida';
  if (item.quantidade_sugerida != null) {
    sugestao = usaPacote
      ? ` · Sugerido: ${item.quantidade_sugerida / p.unidades_por_pacote} pacote(s) (${item.quantidade_sugerida} ${esc(p.unidade)})`
      : ` · Sugerido: ${item.quantidade_sugerida} ${esc(p.unidade)}`;
  }

  const cabecalho = `
    <div class="topo">
      <span class="nome">${esc(p.nome)}${tag}</span>
      <span class="codigo">${esc(p.codigo_interno || '')}</span>
    </div>
    <div class="estoque-atual">Contou: ${item.quantidade_contada} ${esc(p.unidade)}${sugestao}</div>`;

  if (item.comprado) {
    const quando = item.comprado_em ? ` · ${formatarData(item.comprado_em)}` : '';
    return `<div class="produto-card comprado">${cabecalho}
      <div class="selo-comprado">Comprado ✓ ${item.quantidade} ${esc(p.unidade)}${quando}</div>
    </div>`;
  }

  const preenchido = item.quantidade || item.quantidade_sugerida || '';
  return `<div class="produto-card">${cabecalho}
    <div class="campos-produto">
      <div class="campo-mini cheio">
        <label>Quantidade a comprar (${esc(p.unidade)})</label>
        <input type="number" min="0" step="1" inputmode="numeric" value="${preenchido}" data-qtd="${item.id}">
      </div>
    </div>
    <button class="salvar-produto" data-comprar="${item.id}">Marcar como comprado</button>
    <p class="mensagem-form erro" data-msg="${item.id}"></p>
  </div>`;
}

async function marcarComprado(btn) {
  const id = btn.dataset.comprar;
  const item = itensPedidoAtual.find((i) => i.id === id);
  const input = document.querySelector(`[data-qtd="${id}"]`);
  const msg = document.querySelector(`[data-msg="${id}"]`);
  const quantidade = parseFloat(input.value);

  // O banco recusa entrada de estoque com quantidade zero, então barra aqui com uma mensagem clara
  if (isNaN(quantidade) || quantidade <= 0) {
    msg.textContent = 'Informe a quantidade comprada (maior que zero).';
    input.focus();
    return;
  }
  msg.textContent = '';

  const p = item.produtos;
  const confirmou = window.confirm(
    `Confirmar a compra de ${quantidade} ${p.unidade} de ${p.nome}?\n\nIsso dá entrada no estoque e não dá pra desfazer por aqui.`
  );
  if (!confirmou) return;

  btn.disabled = true;
  btn.textContent = 'Salvando…';

  // O trigger do banco cria o movimento de entrada e soma no estoque do produto
  const { error } = await supabaseClient
    .from('itens_pedido')
    .update({ comprado: true, quantidade, comprado_por: sessaoAtual.user.id })
    .eq('id', id);

  if (error) {
    msg.textContent = 'Erro ao salvar: ' + error.message;
    btn.disabled = false;
    btn.textContent = 'Marcar como comprado';
    return;
  }

  await carregarProdutos(); // atualiza estoque e alertas
  await desenharPedido(pedidoSelecionadoId);
}

document.getElementById('seletor-pedido').addEventListener('change', async (e) => {
  pedidoSelecionadoId = e.target.value;
  await desenharPedido(pedidoSelecionadoId);
});

async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    const area = document.createElement('textarea');
    area.value = texto;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

// Monta a lista por categoria (vinho tem outro fornecedor) pra colar no WhatsApp
document.getElementById('copiar-pedido').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const porCategoria = {};

  itensPedidoAtual.filter((i) => precisaPedir(i) && !i.comprado).forEach((item) => {
    const input = document.querySelector(`[data-qtd="${item.id}"]`);
    const quantidade = input ? parseFloat(input.value) : NaN;
    if (isNaN(quantidade) || quantidade <= 0) return;
    const cat = item.produtos.categoria;
    (porCategoria[cat] = porCategoria[cat] || []).push(`• ${item.produtos.nome}: ${quantidade} ${item.produtos.unidade}`);
  });

  const blocos = Object.keys(porCategoria)
    .sort((a, b) => ORDEM_CATEGORIA[a] - ORDEM_CATEGORIA[b])
    .map((cat) => `*${NOME_CATEGORIA[cat]}*\n${porCategoria[cat].join('\n')}`);

  const original = btn.textContent;
  if (blocos.length === 0) {
    btn.textContent = 'Preencha alguma quantidade';
  } else {
    await copiarTexto(`Pedido Jacaré Vermelho\n\n${blocos.join('\n\n')}`);
    btn.textContent = 'Copiado ✓';
  }
  setTimeout(() => { btn.textContent = original; }, 1800);
});

iniciar();