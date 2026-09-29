const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const GRAPH_URL = `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}/messages`;

const CATEGORIAS = [
  { id: 'cat_bebida', valor: 'bebida', titulo: 'Bebidas' },
  { id: 'cat_cerveja', valor: 'cerveja', titulo: 'Cervejas' },
  { id: 'cat_vinho', valor: 'vinho', titulo: 'Vinhos' },
];

// ============================================================
// Handler principal
// ============================================================
module.exports = async (req, res) => {
  if (req.method === 'GET') return handleVerification(req, res);
  if (req.method === 'POST') return handleIncomingMessage(req, res);
  return res.status(405).send('Method not allowed');
};

function handleVerification(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.status(403).send('Verificação falhou');
}

async function handleIncomingMessage(req, res) {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const message = change?.messages?.[0];
    if (!message) return res.status(200).send('ok'); // status/entrega, ignora

    const telefone = message.from;
    const texto = extrairTexto(message);
    console.log(`[whatsapp] Mensagem de ${telefone}: type=${message.type} texto="${texto}"`);

    await processarMensagem(telefone, texto);

    console.log(`[whatsapp] Processamento concluído para ${telefone}`);
    return res.status(200).send('ok');
  } catch (err) {
    console.error('[whatsapp] Erro no webhook:', err);
    return res.status(200).send('erro tratado');
  }
}

function extrairTexto(message) {
  if (message.type === 'text') return message.text.body.trim();
  if (message.type === 'interactive') {
    const i = message.interactive;
    if (i.type === 'list_reply') return i.list_reply.id;
    if (i.type === 'button_reply') return i.button_reply.id;
  }
  return '';
}

// ============================================================
// Máquina de estados
// ============================================================
async function processarMensagem(telefone, texto) {
  const t = texto.toLowerCase().trim();
  if (['cancelar', 'menu', 'sair', 'reiniciar', 'voltar'].includes(t)) {
    await resetConversa(telefone);
    await enviarTexto(telefone, 'Ok, cancelei. Manda "contagem" quando quiser começar de novo.');
    return;
  }

  const conversa = await getConversa(telefone);
  const estado = conversa?.estado || 'inicio';
  const contexto = conversa?.contexto || {};

  switch (estado) {
    case 'inicio':
      return tratarInicio(telefone, texto);
    case 'escolhendo_categoria':
      return tratarEscolhaCategoria(telefone, texto, contexto);
    case 'contando_produto':
      return tratarEscolhaProduto(telefone, texto, contexto);
    case 'aguardando_quantidade':
      return tratarQuantidade(telefone, texto, contexto);
    case 'pos_item':
      return tratarPosItem(telefone, texto, contexto);
    default:
      await resetConversa(telefone);
      return tratarInicio(telefone, texto);
  }
}

async function tratarInicio(telefone, texto) {
  const t = texto.toLowerCase();
  if (!t.includes('contagem') && !t.includes('pedido')) {
    await enviarTexto(telefone, 'Oi! Manda "contagem" pra começar a contagem de bebidas da semana. 🍹');
    return;
  }
  await enviarBotoesCategoria(telefone);
  await setConversa(telefone, 'escolhendo_categoria', { itens: [] });
}

async function tratarEscolhaCategoria(telefone, id, contexto) {
  const categoria = CATEGORIAS.find((c) => c.id === id);
  if (!categoria) {
    await enviarTexto(telefone, 'Escolhe uma das opções, por favor 🙂 (ou manda "cancelar" pra recomeçar)');
    return;
  }
  const { produtos, temMais } = await buscarProdutosPorCategoria(categoria.valor, 0);
  if (produtos.length === 0) {
    await enviarTexto(telefone, `Nenhum produto cadastrado em ${categoria.titulo} ainda.`);
    await enviarBotoesCategoria(telefone);
    return;
  }
  const enviou = await enviarListaProdutos(telefone, produtos, temMais, categoria.titulo);
  if (!enviou) {
    await enviarTexto(telefone, 'Deu um erro ao mostrar a lista. Manda "contagem" de novo pra tentar outra vez.');
    await resetConversa(telefone);
    return;
  }
  await setConversa(telefone, 'contando_produto', { ...contexto, categoria: categoria.valor, categoriaTitulo: categoria.titulo, offset: 0 });
}

async function tratarEscolhaProduto(telefone, id, contexto) {
  if (id === 'mais_produtos') {
    const novoOffset = (contexto.offset || 0) + 9;
    const { produtos, temMais } = await buscarProdutosPorCategoria(contexto.categoria, novoOffset);
    const enviou = await enviarListaProdutos(telefone, produtos, temMais, contexto.categoriaTitulo);
    if (enviou) await setConversa(telefone, 'contando_produto', { ...contexto, offset: novoOffset });
    return;
  }
  if (!id.startsWith('produto_')) {
    await enviarTexto(telefone, 'Escolhe um item da lista, por favor 🙂 (ou manda "cancelar" pra recomeçar)');
    return;
  }
  const produtoId = id.replace('produto_', '');
  await enviarTexto(telefone, 'Quantas unidades tem em estoque agora?');
  await setConversa(telefone, 'aguardando_quantidade', { ...contexto, produto_atual: produtoId });
}

async function tratarQuantidade(telefone, texto, contexto) {
  const quantidade = parseFloat(texto.replace(',', '.'));
  if (isNaN(quantidade) || quantidade < 0) {
    await enviarTexto(telefone, 'Manda só o número da quantidade, tipo: 3');
    return;
  }

  const responsavel = await getOuCriarResponsavel(telefone);
  await supabase.from('contagens_estoque').insert({
    produto_id: contexto.produto_atual,
    quantidade_contada: quantidade,
    responsavel_id: responsavel.id,
  });

  const itens = [...(contexto.itens || []), { produto_id: contexto.produto_atual, quantidade_contada: quantidade }];

  await enviarBotoesPosItem(telefone);
  await setConversa(telefone, 'pos_item', { ...contexto, itens, produto_atual: null });
}

async function tratarPosItem(telefone, id, contexto) {
  if (id === 'mais_itens') {
    const { produtos, temMais } = await buscarProdutosPorCategoria(contexto.categoria, contexto.offset || 0);
    const enviou = await enviarListaProdutos(telefone, produtos, temMais, contexto.categoriaTitulo);
    if (enviou) await setConversa(telefone, 'contando_produto', contexto);
    return;
  }
  if (id === 'trocar_categoria') {
    await enviarBotoesCategoria(telefone);
    await setConversa(telefone, 'escolhendo_categoria', contexto);
    return;
  }
  if (id === 'finalizar') {
    await finalizarContagem(telefone, contexto);
    return;
  }
  await enviarBotoesPosItem(telefone);
}

// ------------------------------------------------------------
// Finaliza: calcula o pedido, salva e avisa responsável + gestores
// ------------------------------------------------------------
async function finalizarContagem(telefone, contexto) {
  const itens = contexto.itens || [];
  if (itens.length === 0) {
    await enviarTexto(telefone, 'Nenhum item contado ainda. Manda "contagem" pra recomeçar quando quiser.');
    await resetConversa(telefone);
    return;
  }

  const responsavel = await getOuCriarResponsavel(telefone);
  const produtoIds = itens.map((i) => i.produto_id);
  const { data: produtos } = await supabase
    .from('produtos')
    .select('id, nome, categoria, media_semanal, quantidade_alerta, unidade, unidades_por_pacote')
    .in('id', produtoIds);

  const { data: pedido } = await supabase
    .from('pedidos')
    .insert({ responsavel_id: responsavel.id, status: 'recebido' })
    .select()
    .single();

  const linhasPedido = [];
  const linhasAlerta = [];

  for (const item of itens) {
    const produto = produtos.find((p) => p.id === item.produto_id);
    if (!produto) continue;

    const usaPacote = produto.categoria !== 'vinho' && produto.unidades_por_pacote != null && produto.unidades_por_pacote > 0;

    let sugeridaUnidades = null;
    let textoSugestao = '';

    if (usaPacote && produto.media_semanal != null) {
      const pacotesEmEstoque = Math.floor(item.quantidade_contada / produto.unidades_por_pacote);
      const pacotesAPedir = Math.max(produto.media_semanal - pacotesEmEstoque, 0);
      sugeridaUnidades = pacotesAPedir * produto.unidades_por_pacote; // guardado em unidades, pra bater com o estoque
      if (pacotesAPedir > 0) {
        textoSugestao = `${produto.nome} ${pacotesAPedir}`; // formato pedido: "pepsi 5" (em pacotes)
      }
    } else if (produto.media_semanal != null) {
      // vinho, ou produto sem unidades_por_pacote ainda configurado: segue em unidades/garrafas
      sugeridaUnidades = Math.max(produto.media_semanal - item.quantidade_contada, 0);
      if (sugeridaUnidades > 0) {
        textoSugestao = `${produto.nome}: pedir ${sugeridaUnidades} ${produto.unidade}`;
      }
    }

    await supabase.from('itens_pedido').insert({
      pedido_id: pedido.id,
      produto_id: produto.id,
      quantidade_contada: item.quantidade_contada,
      quantidade_sugerida: sugeridaUnidades,
      quantidade: sugeridaUnidades,
    });

    if (textoSugestao) linhasPedido.push(`• ${textoSugestao}`);
    if (produto.quantidade_alerta != null && item.quantidade_contada <= produto.quantidade_alerta) {
      linhasAlerta.push(`⚠️ ${produto.nome}: só ${item.quantidade_contada} ${produto.unidade} em estoque`);
    }
  }

  let resumo = `📋 Contagem finalizada!\n\n`;
  resumo += linhasPedido.length > 0
    ? `Pedido sugerido da semana:\n${linhasPedido.join('\n')}`
    : 'Nenhum item precisa de pedido essa semana.';
  if (linhasAlerta.length > 0) {
    resumo += `\n\nAlertas de estoque baixo:\n${linhasAlerta.join('\n')}`;
  }

  await enviarTexto(telefone, resumo);
  await enviarResumoParaGestores(resumo);
  await resetConversa(telefone);
}

async function enviarResumoParaGestores(resumo) {
  const { data: gestores } = await supabase
    .from('usuarios_app')
    .select('telefone_whatsapp')
    .eq('papel', 'gestor')
    .not('telefone_whatsapp', 'is', null);

  for (const g of gestores || []) {
    await enviarTexto(g.telefone_whatsapp, resumo);
  }
}

// ============================================================
// Banco (Supabase)
// ============================================================
async function getConversa(telefone) {
  const { data } = await supabase.from('conversas_whatsapp').select('*').eq('telefone', telefone).maybeSingle();
  return data;
}

async function setConversa(telefone, estado, contexto) {
  await supabase.from('conversas_whatsapp').upsert({
    telefone,
    estado,
    contexto,
    atualizado_em: new Date().toISOString(),
  });
}

async function resetConversa(telefone) {
  await setConversa(telefone, 'inicio', {});
}

async function buscarProdutosPorCategoria(categoria, offset) {
  const { data } = await supabase
    .from('produtos')
    .select('id, nome')
    .eq('categoria', categoria)
    .eq('ativo', true)
    .order('nome')
    .range(offset, offset + 9); // pega 10 pra saber se tem mais

  const temMais = (data || []).length > 9;
  const produtos = (data || []).slice(0, 9);
  return { produtos, temMais };
}

async function getOuCriarResponsavel(telefone) {
  const { data: existente } = await supabase.from('responsaveis').select('*').eq('telefone', telefone).maybeSingle();
  if (existente) return existente;
  const { data: novo } = await supabase.from('responsaveis').insert({ telefone }).select().single();
  return novo;
}

// ============================================================
// Envio de mensagens (WhatsApp Cloud API)
// ============================================================
async function chamarGraphAPI(payload) {
  const resposta = await fetch(GRAPH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resposta.ok) {
    console.error(`[whatsapp] Graph API erro ${resposta.status}:`, await resposta.text());
    return false;
  }
  return true;
}

async function enviarTexto(telefone, texto) {
  return chamarGraphAPI({ messaging_product: 'whatsapp', to: telefone, type: 'text', text: { body: texto } });
}

async function enviarBotoesCategoria(telefone) {
  return chamarGraphAPI({
    messaging_product: 'whatsapp',
    to: telefone,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: 'Qual categoria você vai contar?' },
      action: { buttons: CATEGORIAS.map((c) => ({ type: 'reply', reply: { id: c.id, title: c.titulo } })) },
    },
  });
}

async function enviarBotoesPosItem(telefone) {
  return chamarGraphAPI({
    messaging_product: 'whatsapp',
    to: telefone,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: 'O que você quer fazer agora?' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'mais_itens', title: 'Contar outro item' } },
          { type: 'reply', reply: { id: 'trocar_categoria', title: 'Trocar categoria' } },
          { type: 'reply', reply: { id: 'finalizar', title: 'Finalizar' } },
        ],
      },
    },
  });
}

async function enviarListaProdutos(telefone, produtos, temMais, categoriaTitulo) {
  const rows = produtos.map((p) => ({ id: `produto_${p.id}`, title: p.nome.slice(0, 24) }));
  if (temMais) rows.push({ id: 'mais_produtos', title: 'Ver mais itens ➜' });

  return chamarGraphAPI({
    messaging_product: 'whatsapp',
    to: telefone,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: `${categoriaTitulo}: qual item você vai contar?` },
      action: { button: 'Escolher item', sections: [{ title: categoriaTitulo, rows }] },
    },
  });
}