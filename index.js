const express = require('express');
const bodyParser = require('body-parser');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');

const app = express();
app.use(bodyParser.json());

// === CONFIGURAÇÕES SIMPLES ===
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
if (!DISCORD_TOKEN) {
    console.error("❌ Coloque o token do bot como variável de ambiente DISCORD_TOKEN");
    process.exit(1);
}
const PORT = process.env.PORT || 3000;
const SHARED_SECRET = "emfm1210"; // mesmo usado no Roblox

const codes = new Map(); // Map para armazenar códigos

// Endpoint que o Roblox chama
app.post('/create_code', (req, res) => {
    const body = req.body;

    if (!body.code || !body.robloxUsername || body.secret !== SHARED_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const code = body.code;
    const entry = {
        robloxUsername: body.robloxUsername,
        team: body.team || "NoTeam",
        expiresAt: body.expiresAt || (Date.now()/1000 + 60*10),
        used: false
    };

    codes.set(code, entry);
    console.log("Código criado:", code, entry);
    return res.json({ ok: true });
});

// Limpeza automática dos códigos expirados
setInterval(() => {
    const now = Math.floor(Date.now()/1000);
    for (const [k, v] of codes.entries()) {
        if (v.expiresAt < now || v.used) codes.delete(k);
    }
}, 1000 * 60 * 5);

// === BOT DISCORD ===
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once('clientReady', () => {
    console.log(`✅ Bot logado como ${client.user.tag}`);
});

// Cria e registra o comando /verify
async function registerCommand() {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    const command = new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Verifica seu código vindo do Roblox')
        .addStringOption(opt => opt.setName('codigo').setDescription('Código gerado no Roblox').setRequired(true));

    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: [command.toJSON()] });
        console.log("✅ Comando /verify registrado globalmente");
    } catch (err) {
        console.error("Erro ao registrar comando:", err);
    }
}

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'verify') {
        const code = interaction.options.getString('codigo').trim();
        const entry = codes.get(code);
        const now = Math.floor(Date.now()/1000);

        if (!entry) {
            return interaction.reply({ content: '❌ Código inválido ou expirado.', ephemeral: true });
        }
        if (entry.used) {
            return interaction.reply({ content: '⚠️ Esse código já foi usado.', ephemeral: true });
        }
        if (entry.expiresAt < now) {
            codes.delete(code);
            return interaction.reply({ content: '⏰ Esse código expirou.', ephemeral: true });
        }

        // Nome do nick: Discord(Roblox)(Team)
        const newNick = `${interaction.user.username}(${entry.robloxUsername})(${entry.team})`;

        try {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            await member.setNickname(newNick, 'Verificação Roblox');
            entry.used = true;
            codes.set(code, entry);
            return interaction.reply({ content: `✅ Verificado! Seu nickname foi alterado para:\n\`${newNick}\``, ephemeral: false });
        } catch (err) {
            console.error('Erro ao mudar nick:', err);
            return interaction.reply({ content: '❌ O bot não conseguiu mudar seu nickname. Verifique as permissões.', ephemeral: true });
        }
    }
});

// Inicia servidor + bot
app.listen(PORT, async () => {
    console.log(`🌐 Servidor HTTP rodando na porta ${PORT}`);
    client.login(DISCORD_TOKEN).then(registerCommand);
});
