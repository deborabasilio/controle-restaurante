const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const token = (req.headers['authorization'] || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Não autenticado' });

  // Descobre quem está chamando e confirma que é gestor
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user) return res.status(401).json({ error: 'Sessão inválida' });

  const { data: chamador } = await supabaseAdmin
    .from('usuarios_app')
    .select('papel')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (!chamador || chamador.papel !== 'gestor') {
    return res.status(403).json({ error: 'Só o gestor pode convidar novos usuários' });
  }

  const { nome, email, papel, telefone_whatsapp } = req.body || {};
  if (!nome || !email || !papel) {
    return res.status(400).json({ error: 'Preencha nome, e-mail e papel' });
  }
  if (!['funcionario', 'gestor'].includes(papel)) {
    return res.status(400).json({ error: 'Papel inválido' });
  }

  const { error: convidarError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    data: { nome, papel, telefone_whatsapp: telefone_whatsapp || null },
  });

  if (convidarError) {
    console.error('[convidar-usuario] Erro:', convidarError);
    return res.status(500).json({ error: convidarError.message });
  }

  return res.status(200).json({ ok: true });
};
