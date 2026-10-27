const fs = require('fs');
const path = require('path');

// 1. Configurações de caminhos
const arquivoEntrada = 'playnite_export.json';
const pastaSaida = 'Biblioteca_de_Jogos';
const pastaPlaynite = path.join(process.env.APPDATA, 'Playnite', 'libraryfiles');

// Função para remover caracteres inválidos para pastas no Windows
const sanitizarNome = (nome) => nome.replace(/[\\/*?:"<>|]/g, '').trim();

// Função para extrair a extensão do arquivo original (ex: .jpg, .png)
const obterExtensao = (caminho) => path.extname(caminho);

function extrairBiblioteca() {
  if (!fs.existsSync(arquivoEntrada)) {
    console.error(`❌ Erro: Arquivo '${arquivoEntrada}' não encontrado.`);
    return;
  }

  if (!fs.existsSync(pastaSaida)) {
    fs.mkdirSync(pastaSaida);
  }

  const dadosPlaynite = JSON.parse(fs.readFileSync(arquivoEntrada, 'utf8'));
  const listaGamesJson = [];

  console.log('Iniciando processamento dos jogos...\n');

  dadosPlaynite.forEach((jogo) => {
    if (!jogo.Name) return;

    const nomeSeguro = sanitizarNome(jogo.Name);
    
    // Mapeamento das propriedades do Playnite para os nomes do PWA
    const mapeamentoMidias = {
      CoverImage: 'cover',
      BackgroundImage: 'banner',
      Icon: 'icon'
    };

    // Array temporário para guardar o que realmente existe no PC para este jogo
    const arquivosParaCopiar = [];

    // 1. PRIMEIRO: Apenas verifica a existência dos arquivos, sem criar nada ainda
    Object.keys(mapeamentoMidias).forEach((chavePlaynite) => {
      const caminhoRelativo = jogo[chavePlaynite];
      
      if (caminhoRelativo) {
        const caminhoOrigem = path.join(pastaPlaynite, caminhoRelativo);
        
        if (fs.existsSync(caminhoOrigem)) {
          const extensao = obterExtensao(caminhoOrigem);
          const nomeFinal = `${mapeamentoMidias[chavePlaynite]}${extensao}`;
          
          arquivosParaCopiar.push({
            origem: caminhoOrigem,
            nomeFinal: nomeFinal
          });
        }
      }
    });

    // 2. SEGUNDO: Se encontrou pelo menos uma mídia, cria a pasta e salva no JSON
    if (arquivosParaCopiar.length > 0) {
      // Cadastra no JSON
      listaGamesJson.push({ name: jogo.Name });

      // Cria a subpasta apenas se necessário
      const pastaJogo = path.join(pastaSaida, nomeSeguro);
      if (!fs.existsSync(pastaJogo)) {
        fs.mkdirSync(pastaJogo);
      }

      // 3. Copia os arquivos que foram encontrados
      arquivosParaCopiar.forEach((arquivo) => {
        const caminhoDestino = path.join(pastaJogo, arquivo.nomeFinal);
        fs.copyFileSync(arquivo.origem, caminhoDestino);
      });

    } else {
      // Opcional: exibe log no terminal informando que o jogo foi ignorado
      console.log(`[Ignorado] ${jogo.Name} -> Nenhuma mídia encontrada.`);
    }
  });

  // Gera o arquivo games.json apenas com os jogos que possuem mídia
  const caminhoJsonFinal = path.join(pastaSaida, 'games.json');
  fs.writeFileSync(caminhoJsonFinal, JSON.stringify(listaGamesJson, null, 2), 'utf8');

  console.log('\n✅ Extração concluída com sucesso!');
  console.log(`📂 O arquivo games.json e as pastas foram salvos em: ${pastaSaida}`);
  console.log(`🎮 Total de jogos com mídias extraídos: ${listaGamesJson.length}`);
}

extrairBiblioteca();