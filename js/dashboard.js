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
    window.location.href = '/index.html';
    return;
  }
  await carregarProdutos();
  await carregarMeusDados(data.session);
}

document.getElementById('sair').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  window.location.href = '/index.html';
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
    .select('id, nome, codigo_interno, categoria, unidade, quantidade_estoque, media_semanal, quantidade_alerta')
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
    .map(
      (p) => `
    <div class="produto-card">
      <div class="topo">
        <span class="nome">${p.nome}</span>
        <span class="codigo">${p.codigo_interno || ''}</span>
      </div>
      <div class="estoque-atual">Estoque atual: ${p.quantidade_estoque} ${p.unidade}</div>
      <div class="campos-produto">
        <div class="campo-mini">
          <label>Média semanal</label>
          <input type="number" step="1" min="0" value="${p.media_semanal ?? ''}" data-media="${p.id}" placeholder="—">
        </div>
        <div class="campo-mini">
          <label>Alerta em</label>
          <input type="number" step="1" min="0" value="${p.quantidade_alerta ?? ''}" data-alerta="${p.id}" placeholder="—">
        </div>
      </div>
      <button class="salvar-produto" data-salvar="${p.id}">Salvar</button>
    </div>`
    )
    .join('');

  container.querySelectorAll('[data-salvar]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.salvar;
      const media = container.querySelector(`[data-media="${id}"]`).value;
      const alerta = container.querySelector(`[data-alerta="${id}"]`).value;
      await salvarProduto(id, {
        media_semanal: media === '' ? null : parseFloat(media),
        quantidade_alerta: alerta === '' ? null : parseFloat(alerta),
      });
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

  const resposta = await fetch('/api/convidar-usuario', {
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

iniciar();