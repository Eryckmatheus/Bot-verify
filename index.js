const express = require('express');
const bodyParser = require('body-parser');
const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    EmbedBuilder, 
    PermissionsBitField 
} = require('discord.js');

const app = express();
app.use(bodyParser.json());

// === CONFIGURAÇÕES ===
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
if (!DISCORD_TOKEN) {
    console.error("❌ Coloque o token do bot como variável de ambiente DISCORD_TOKEN");
    process.exit(1);
}
const PORT = process.env.PORT || 3000;
const SHARED_SECRET = "emfm1210"; // mesmo usado no Roblox

const OWNER_ID = "1199091786589683805";
const codes = new Map();
const guildConfigs = new Map(); // guildId -> { nickFormat, roleId }

// === API Roblox ===
app.post('/create_code', (req, res) => {
    const body = req.body;
    if (!body.code || !body.robloxUsername || body.secret !== SHARED_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const entry = {
        robloxUsername: body.robloxUsername,
        team: body.team || "NoTeam",
        expiresAt: body.expiresAt || (Date.now()/1000 + 600),
        used: false
    };

    codes.set(body.code, entry);
    console.log("Código criado:", body.code, entry);
    res.json({ ok: true });
});

setInterval(() => {
    const now = Math.floor(Date.now()/1000);
    for (const [k, v] of codes.entries()) {
        if (v.expiresAt < now || v.used) codes.delete(k);
    }
}, 1000 * 60 * 5);

// === BOT DISCORD ===
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once('ready', () => {
    console.log(`✅ Bot logado como ${client.user.tag}`);
    registerCommands();
});

// === REGISTRO DE COMANDOS ===
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

    const commands = [
        new SlashCommandBuilder()
            .setName('verify')
            .setDescription('Verifica seu código vindo do Roblox')
            .addStringOption(opt => 
                opt.setName('codigo')
                   .setDescription('Código gerado no Roblox')
                   .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('config')
            .setDescription('Configura o sistema de verificação (apenas admin)')
    ];

    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands.map(cmd => cmd.toJSON()) }
        );
        console.log("✅ Comandos registrados: /verify e /config");
    } catch (err) {
        console.error("Erro ao registrar comandos:", err);
    }
}

// === INTERAÇÕES ===
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // =============== /verify ===============
    if (interaction.commandName === 'verify') {
        const code = interaction.options.getString('codigo').trim();
        const entry = codes.get(code);
        const now = Math.floor(Date.now()/1000);

        if (!entry) return interaction.reply({ content: '❌ Código inválido ou expirado.', ephemeral: true });
        if (entry.used) return interaction.reply({ content: '⚠️ Esse código já foi usado.', ephemeral: true });
        if (entry.expiresAt < now) {
            codes.delete(code);
            return interaction.reply({ content: '⏰ Esse código expirou.', ephemeral: true });
        }

        const config = guildConfigs.get(interaction.guild.id);
        let nickFormat = config?.nickFormat || '(nickdc)(nickroblox)(team)';
        let roleId = config?.roleId || null;

        // Substitui variáveis
        const formattedNick = nickFormat
            .replace('(nickdc)', interaction.user.username)
            .replace('(nickroblox)', entry.robloxUsername)
            .replace('(team)', entry.team);

        try {
            const member = await interaction.guild.members.fetch(interaction.user.id);

            // Impede quem já tem o cargo configurado
            if (roleId && member.roles.cache.has(roleId)) {
                return interaction.reply({ content: '🚫 Você já está verificado e possui o cargo configurado.', ephemeral: true });
            }

            await member.setNickname(formattedNick, 'Verificação Roblox');

            if (roleId) {
                await member.roles.add(roleId);
            }

            entry.used = true;
            codes.set(code, entry);

            return interaction.reply({ 
                content: `✅ Verificado com sucesso!\nSeu nick agora é: **${formattedNick}**${roleId ? `\nCargo recebido: <@&${roleId}>` : ''}` 
            });
        } catch (err) {
            console.error('Erro ao verificar:', err);
            return interaction.reply({ content: '❌ Não foi possível alterar seu nick ou cargo. Verifique permissões.', ephemeral: true });
        }
    }

    // =============== /config ===============
    if (interaction.commandName === 'config') {
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({ content: '🚫 Você não tem permissão para usar este comando.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('⚙️ Configuração do Sistema de Verificação')
            .setDescription('Escolha o que deseja configurar abaixo:')
            .addFields(
                { name: '1️⃣ Ordem do Nick', value: 'Defina a ordem do nickname usando variáveis:\n`(nickdc)` `(nickroblox)` `(team)`' },
                { name: '2️⃣ Cargo', value: 'Defina qual cargo o jogador ganha ao verificar.\nUsuários com este cargo não poderão se verificar novamente.' }
            )
            .setColor('Blue')
            .setFooter({ text: 'Use os comandos abaixo no chat para configurar.' });

        await interaction.reply({ embeds: [embed], ephemeral: true });

        // Envia instruções
        await interaction.followUp({
            content: "💬 Envie a ordem do nick agora (ex: `(nickroblox) - (team) - (nickdc)`):",
            ephemeral: true
        });

        const filter = m => m.author.id === interaction.user.id;
        const collector = interaction.channel.createMessageCollector({ filter, time: 60000 });

        let step = 0;
        let nickFormat = '';
        collector.on('collect', async msg => {
            if (step === 0) {
                nickFormat = msg.content;
                step++;
                await msg.reply("✅ Ordem do nick salva! Agora envie o ID do cargo (ou mencione ele).");
            } else if (step === 1) {
                const roleId = msg.mentions.roles.first()?.id || msg.content.replace(/\D/g, '');
                guildConfigs.set(interaction.guild.id, { nickFormat, roleId });
                await msg.reply(`✅ Configuração completa!\n📛 Nick format: \`${nickFormat}\`\n🎭 Cargo: <@&${roleId}>`);
                collector.stop();
            }
        });
    }
});

// === INICIA SERVIDOR ===
app.listen(PORT, () => {
    console.log(`🌐 Servidor HTTP rodando na porta ${PORT}`);
    client.login(DISCORD_TOKEN);
});
