const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const GRAPH_URL = `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}/messages`;

module.exports = async (req, res) => {
  // Protege o endpoint: só a própria Vercel (via Cron) pode chamar isso,
  // usando o header Authorization com o CRON_SECRET configurado.
  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).send('Não autorizado');
  }

  const { data: responsaveis, error } = await supabase
    .from('responsaveis')
    .select('telefone')
    .eq('ativo', true);

  if (error) {
    console.error('Erro ao buscar responsáveis:', error);
    return res.status(500).send('Erro ao buscar responsáveis');
  }

  for (const r of responsaveis || []) {
    await enviarTexto(r.telefone);
  }

  return res.status(200).send(`Lembrete enviado para ${responsaveis?.length || 0} responsável(is)`);
};

async function enviarTexto(telefone) {
  await fetch(GRAPH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: telefone,
      type: 'text',
      text: {
        body: '📋 Bom dia! Hoje é dia de contar o estoque de bebidas e fazer os pedidos da semana. Manda "pedido" pra começar.',
      },
    }),
  });
}