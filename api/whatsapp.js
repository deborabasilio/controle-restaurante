const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

const GRAPH_URL = `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}/messages`;

// ============================================================
// Handler principal (Vercel chama isso pra GET e POST em /api/whatsapp)
// ============================================================
module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return handleVerification(req, res);
  }
  if (req.method === 'POST') {
    return handleIncomingMessage(req, res);
  }
  return res.status(405).send('Method not allowed');
};

// ------------------------------------------------------------
// Verificação inicial do webhook (a Meta chama isso uma vez,
// quando você cola a URL nas configurações do app)
// ------------------------------------------------------------
function handleVerification(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.status(403).send('Verificação falhou');
}

// ------------------------------------------------------------
// Mensagem recebida de verdade
// ------------------------------------------------------------
async function handleIncomingMessage(req, res) {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const message = change?.messages?.[0];

    // A Meta também manda notificações de status (entregue/lido) sem "messages" - ignora
    if (!message) {
      return res.status(200).send('ok');
    }

    const telefone = message.from; // já vem em formato E.164, ex: "5544999999999"
    const texto = extrairTexto(message);

    await processarMensagem(telefone, texto);

    return res.status(200).send('ok');
  } catch (err) {
    console.error('Erro no webhook:', err);
    // Sempre responde 200 pra Meta não ficar reenviando a mesma mensagem
    return res.status(200).send('erro tratado');
  }
}

function extrairTexto(message) {
  if (message.type === 'text') return message.text.body.trim();
  if (message.type === 'interactive') {
    const interactive = message.interactive;
    if (interactive.type === 'list_reply') return interactive.list_reply.id;
    if (interactive.type === 'button_reply') return interactive.button_reply.id;
  }
  return '';
}

// ============================================================
// Máquina de estados da conversa
// ============================================================
async function processarMensagem(telefone, texto) {
  const conversa = await getConversa(telefone);
  const estado = conversa?.estado || 'inicio';
  const contexto = conversa?.contexto || {};

  if (estado === 'inicio') {
    return tratarInicio(telefone, texto);
  }
  if (estado === 'aguardando_produto') {
    return tratarEscolhaProduto(telefone, texto, contexto);
  }
  if (estado === 'aguardando_quantidade') {
    return tratarQuantidade(telefone, texto, contexto);
  }

  // fallback de segurança
  await resetConversa(telefone);
  return tratarInicio(telefone, texto);
}

// ------------------------------------------------------------
// Estado inicial: reconhece a intenção (pedido ou retirada)
// ------------------------------------------------------------
async function tratarInicio(telefone, texto) {
  const t = texto.toLowerCase();
  const ehPedido = t.includes('pedido') || t === 'menu_pedido';
  const ehRetirada = t.includes('retir') || t.includes('saiu') || t === 'menu_saida';

  if (!ehPedido && !ehRetirada) {
    return enviarBotoesMenu(telefone);
  }

  const tipo = ehPedido ? 'pedido' : 'saida';
  const produtos = await buscarProdutosAtivos();

  if (produtos.length === 0) {
    await enviarTexto(telefone, 'Nenhum produto cadastrado ainda. Fala com o gestor pra cadastrar antes.');
    return;
  }

  await enviarListaProdutos(telefone, produtos, tipo);
  await setConversa(telefone, 'aguardando_produto', { tipo });
}

// ------------------------------------------------------------
// Estado: aguardando escolha do produto na lista
// ------------------------------------------------------------
async function tratarEscolhaProduto(telefone, idProduto, contexto) {
  if (!idProduto.startsWith('produto_')) {
    await enviarTexto(telefone, 'Escolhe um item da lista, por favor 🙂');
    return;
  }

  const produtoId = idProduto.replace('produto_', '');
  await enviarTexto(telefone, 'Quantas unidades?');
  await setConversa(telefone, 'aguardando_quantidade', { ...contexto, produto_id: produtoId });
}

// ------------------------------------------------------------
// Estado: aguardando a quantidade (número digitado)
// ------------------------------------------------------------
async function tratarQuantidade(telefone, texto, contexto) {
  const quantidade = parseFloat(texto.replace(',', '.'));

  if (isNaN(quantidade) || quantidade <= 0) {
    await enviarTexto(telefone, 'Manda só o número da quantidade, tipo: 3');
    return;
  }

  const responsavel = await getOuCriarResponsavel(telefone);

  if (contexto.tipo === 'saida') {
    await registrarSaida(contexto.produto_id, quantidade, responsavel.id);
    await enviarTexto(telefone, '✅ Retirada registrada! Quer fazer mais alguma coisa? Manda "pedido" ou "retirar".');
  } else {
    await registrarItemPedido(contexto.produto_id, quantidade, responsavel.id);
    await enviarTexto(telefone, '✅ Item adicionado ao pedido! Quer fazer mais alguma coisa? Manda "pedido" ou "retirar".');
  }

  await resetConversa(telefone);
}

// ============================================================
// Acesso ao banco (Supabase)
// ============================================================
async function getConversa(telefone) {
  const { data } = await supabase
    .from('conversas_whatsapp')
    .select('*')
    .eq('telefone', telefone)
    .maybeSingle();
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

async function buscarProdutosAtivos() {
  const { data } = await supabase
    .from('produtos')
    .select('id, nome')
    .eq('ativo', true)
    .order('nome')
    .limit(10); // limite da lista interativa do WhatsApp
  return data || [];
}

async function getOuCriarResponsavel(telefone) {
  const { data: existente } = await supabase
    .from('responsaveis')
    .select('*')
    .eq('telefone', telefone)
    .maybeSingle();

  if (existente) return existente;

  const { data: novo } = await supabase
    .from('responsaveis')
    .insert({ telefone })
    .select()
    .single();
  return novo;
}

async function registrarSaida(produtoId, quantidade, responsavelId) {
  await supabase.from('movimentos_estoque').insert({
    produto_id: produtoId,
    tipo: 'saida',
    quantidade,
    origem: 'consumo_interno',
    registrado_via: 'whatsapp',
    responsavel_id: responsavelId,
  });
}

async function registrarItemPedido(produtoId, quantidade, responsavelId) {
  // Por enquanto cria um pedido novo por item; dá pra evoluir depois
  // pra agrupar vários itens no mesmo pedido antes de fechar.
  const { data: pedido } = await supabase
    .from('pedidos')
    .insert({ responsavel_id: responsavelId, status: 'recebido' })
    .select()
    .single();

  await supabase.from('itens_pedido').insert({
    pedido_id: pedido.id,
    produto_id: produtoId,
    quantidade,
  });
}

// ============================================================
// Envio de mensagens (WhatsApp Cloud API)
// ============================================================
async function chamarGraphAPI(payload) {
  await fetch(GRAPH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

async function enviarTexto(telefone, texto) {
  await chamarGraphAPI({
    messaging_product: 'whatsapp',
    to: telefone,
    type: 'text',
    text: { body: texto },
  });
}

async function enviarBotoesMenu(telefone) {
  await chamarGraphAPI({
    messaging_product: 'whatsapp',
    to: telefone,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: 'O que você quer fazer?' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'menu_pedido', title: 'Fazer pedido' } },
          { type: 'reply', reply: { id: 'menu_saida', title: 'Registrar retirada' } },
        ],
      },
    },
  });
}

async function enviarListaProdutos(telefone, produtos, tipo) {
  const rows = produtos.map((p) => ({
    id: `produto_${p.id}`,
    title: p.nome.slice(0, 24), // limite do WhatsApp por linha
  }));

  await chamarGraphAPI({
    messaging_product: 'whatsapp',
    to: telefone,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: tipo === 'saida' ? 'O que você está retirando?' : 'O que você quer pedir?' },
      action: {
        button: 'Escolher item',
        sections: [{ title: 'Produtos', rows }],
      },
    },
  });
}