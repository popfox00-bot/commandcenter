(function(){
  "use strict";

  var STORAGE_KEY = "foxGames";
  var store = { dailyLog: {}, settings: { theme:"dark" }, favorites: null, highScores: {}, longestTimes: {}, checkersRecord: { wins:0, losses:0, totalMovesInWins:0, movesTrackedWins:0 }, solitaireRecord: { wins:0, played:0, bestMoves:null }, tileMatchRecord: { easy:{ played:0, bestTimeMs:null, bestPoints:0 }, medium:{ played:0, bestTimeMs:null, bestPoints:0 }, hard:{ played:0, bestTimeMs:null, bestPoints:0 } }, blackjackRecord: { wins:0, losses:0, pushes:0, blackjacks:0 }, blackjackBalance: 100 };

  function loadStore(){
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw){
        var parsed = JSON.parse(raw);
        if (parsed && parsed.dailyLog) store = parsed;
        if (!store.settings) store.settings = { theme:"dark" };
        if (!store.highScores) store.highScores = {};
        if (!store.longestTimes) store.longestTimes = {};
        if (!store.checkersRecord) store.checkersRecord = { wins:0, losses:0, totalMovesInWins:0, movesTrackedWins:0 };
        if (store.checkersRecord.totalMovesInWins === undefined) store.checkersRecord.totalMovesInWins = 0;
        if (store.checkersRecord.movesTrackedWins === undefined) store.checkersRecord.movesTrackedWins = 0;
        if (!store.solitaireRecord) store.solitaireRecord = { wins:0, played:0, bestMoves:null };
        if (store.solitaireRecord.wins === undefined) store.solitaireRecord.wins = 0;
        if (store.solitaireRecord.played === undefined) store.solitaireRecord.played = 0;
        if (store.solitaireRecord.bestMoves === undefined) store.solitaireRecord.bestMoves = null;
        if (!store.tileMatchRecord) store.tileMatchRecord = {};
        // migrate a pre-difficulty flat record (old shape) into the "hard" bucket,
        // since 6x7/21-pair was the only mode that existed before difficulty tiers.
        if (store.tileMatchRecord.played !== undefined && !store.tileMatchRecord.hard){
          store.tileMatchRecord = { easy:{played:0,bestTimeMs:null,bestPoints:0}, medium:{played:0,bestTimeMs:null,bestPoints:0}, hard: store.tileMatchRecord };
        }
        ["easy","medium","hard"].forEach(function(k){
          if (!store.tileMatchRecord[k]) store.tileMatchRecord[k] = { played:0, bestTimeMs:null, bestPoints:0 };
          if (store.tileMatchRecord[k].played === undefined) store.tileMatchRecord[k].played = 0;
          if (store.tileMatchRecord[k].bestTimeMs === undefined) store.tileMatchRecord[k].bestTimeMs = null;
          if (store.tileMatchRecord[k].bestPoints === undefined) store.tileMatchRecord[k].bestPoints = 0;
        });
        if (!store.blackjackRecord) store.blackjackRecord = { wins:0, losses:0, pushes:0, blackjacks:0 };
        if (store.blackjackRecord.wins === undefined) store.blackjackRecord.wins = 0;
        if (store.blackjackRecord.losses === undefined) store.blackjackRecord.losses = 0;
        if (store.blackjackRecord.pushes === undefined) store.blackjackRecord.pushes = 0;
        if (store.blackjackRecord.blackjacks === undefined) store.blackjackRecord.blackjacks = 0;
        if (store.blackjackBalance === undefined || store.blackjackBalance === null) store.blackjackBalance = 100;
      }
    }catch(e){}
  }
  function saveStore(){
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }catch(e){}
  }
  function pad(n){ return n < 10 ? "0"+n : ""+n; }
  function todayStr(){ var d=new Date(); return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); }
  function fmtTime(ms){
    var totalSec = Math.floor(ms/1000);
    var m = Math.floor(totalSec/60), s = totalSec%60;
    return m + ":" + pad(s);
  }

  // ================= THEME =================
  function applyTheme(theme){
    document.documentElement.setAttribute("data-theme", theme);
    document.getElementById("themeLightBtn").classList.toggle("active", theme === "light");
    document.getElementById("themeDarkBtn").classList.toggle("active", theme === "dark");
    document.querySelector('meta[name="theme-color"]').setAttribute("content", theme === "light" ? "#F4F1EA" : "#1F2430");
  }
  function setTheme(theme){
    store.settings.theme = theme;
    saveStore();
    applyTheme(theme);
  }
  document.getElementById("themeLightBtn").addEventListener("click", function(){ setTheme("light"); });
  document.getElementById("themeDarkBtn").addEventListener("click", function(){ setTheme("dark"); });

  // ================= GAME CATALOG =================
  var GAMES = [
    { id:"chess", name:"Best Move", page:"chessPage", defaultFavorite:true, icon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.5 3-1.5 2-1.5-2L12 3z"/><path d="M8 21h8"/><path d="M9 21c-.5-3 .5-5 1-6.5C10.5 13 9 12 9 10c0-1.7 1.3-3 3-3s3 1.3 3 3c0 2-1.5 3-1.5 4.5.5 1.5 1.5 3.5 1 6.5"/></svg>'
    },
    { id:"checkers", name:"Checkers", page:"checkersPage", defaultFavorite:false, icon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="15" r="5"/><circle cx="15" cy="9" r="5" fill="white"/></svg>'
    },
    { id:"roadgame", name:"That One Ad", page:"roadPage", defaultFavorite:false, icon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3L7 21"/><path d="M15 3l2 18"/><path d="M11 8h2M10.5 13h3M10 18h4"/></svg>'
    },
    { id:"spellingbee", name:"Spelling Bee", page:"spellingbeePage", defaultFavorite:false, icon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="12,3 19,7 19,15 12,19 5,15 5,7"/><circle cx="12" cy="11" r="2.4" fill="white" stroke="none"/></svg>'
    },
    { id:"dailyfive", name:"Daily Word", page:"dailyFivePage", defaultFavorite:false, icon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="9" width="3.4" height="4"/><rect x="5.2" y="9" width="3.4" height="4"/><rect x="9.4" y="9" width="3.4" height="4"/><rect x="13.6" y="9" width="3.4" height="4" fill="white"/><rect x="17.8" y="9" width="3.4" height="4"/></svg>'
    },
    { id:"solitaire", name:"Solitaire", page:"solitairePage", defaultFavorite:false, icon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="10" height="14" rx="1.6"/><path d="M18 7h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H10a1 1 0 0 1-1-1v-2" fill="none"/><path d="M9 8l1.6 3.2h-3.2z" fill="white" stroke="none"/></svg>'
    },
    { id:"tilematch", name:"Tile Match", page:"tileMatchPage", defaultFavorite:false, icon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/><rect x="14" y="14" width="7" height="7" rx="1.2" fill="white"/></svg>'
    },
    { id:"blackjack", name:"Blackjack", page:"blackjackPage", defaultFavorite:false, icon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="10" height="15" rx="1.6"/><rect x="10" y="6" width="10" height="15" rx="1.6" fill="white" stroke="none"/><text x="14" y="16" font-size="7" fill="black" font-weight="bold" text-anchor="middle" font-family="sans-serif">A</text></svg>'
    },
    { id:"bballdraft", name:"Basketball Draft", page:"bballPage", defaultFavorite:false, icon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18"/></svg>'
    }
  ];
  function ensureFavorites(){
    if (!store.favorites || !Array.isArray(store.favorites)){
      store.favorites = GAMES.filter(function(g){ return g.defaultFavorite; }).map(function(g){ return g.id; });
      saveStore();
    }
  }
  function isFavorite(id){ return store.favorites.indexOf(id) !== -1; }
  function toggleFavorite(id){
    if (isFavorite(id)) store.favorites = store.favorites.filter(function(x){ return x !== id; });
    else store.favorites.push(id);
    saveStore();
  }

  // ================= SETTINGS: PER-GAME LIST =================
  // Resets Best Move as if today had never been played — removes today's saved result
  // (so the puzzle regenerates fresh) and its contribution to Best Move's statistics,
  // without touching any other day's history.
  function resetBestMoveToday(){
    var today = todayStr();
    if (store.dailyLog.chess) delete store.dailyLog.chess[today];
    saveStore();
  }

  function renderGameSettings(){
    var list = document.getElementById("gameSettingsList");
    list.innerHTML = "";
    GAMES.forEach(function(g){
      var row = document.createElement("div");
      row.className = "setting-row";
      var label = document.createElement("div");
      label.innerHTML = '<div class="setting-label">' + g.name + '</div>';
      row.appendChild(label);
      if (g.id === "chess"){
        var resetBtn = document.createElement("button");
        resetBtn.className = "mini-btn";
        resetBtn.textContent = "Reset";
        resetBtn.addEventListener("click", function(){
          resetBestMoveToday();
          resetBtn.textContent = "Done";
          setTimeout(function(){ resetBtn.textContent = "Reset"; }, 1200);
        });
        row.appendChild(resetBtn);
      }
      list.appendChild(row);
    });
  }

  // ================= NAVIGATION =================
  var pages = ["favoritesPage","newGamesPage","statsPage","settingsPage","chessPage","checkersPage","roadPage","spellingbeePage","dailyFivePage","solitairePage","tileMatchPage","blackjackPage","bballPage"];
  function showPage(id){
    pages.forEach(function(p){ document.getElementById(p).classList.toggle("active", p===id); });
    ["tabFavorites","tabNewGames","tabStats","tabSettings"].forEach(function(t){
      document.getElementById(t).classList.toggle("active", document.getElementById(t).dataset.page === id);
    });
    if (id === "statsPage") renderStats();
    if (id === "favoritesPage") renderFavorites();
    if (id === "newGamesPage") renderNewGames();
    if (id === "settingsPage") renderGameSettings();
    if (id !== "roadPage") stopRoadGame();
    if (id !== "tileMatchPage") stopTileMatch();
  }
  document.querySelectorAll(".tab-btn").forEach(function(btn){
    btn.addEventListener("click", function(){ showPage(btn.dataset.page); });
  });

  function openGame(g){
    showPage(g.page);
    if (g.id === "chess") openChess();
    else if (g.id === "checkers") openCheckers();
    else if (g.id === "roadgame") openRoadGame();
    else if (g.id === "spellingbee") openSpellingBee();
    else if (g.id === "dailyfive") openDailyFive();
    else if (g.id === "solitaire") openSolitaire();
    else if (g.id === "tilematch") openTileMatch();
    else if (g.id === "blackjack") openBlackjack();
    else if (g.id === "bballdraft") openBballDraft();
  }

  // ================= FAVORITES / NEW GAMES (shared heart-tile rendering) =================
  function heartSVG(){
    return '<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
  }
  function buildGameTile(g){
    var item = document.createElement("div");
    item.className = "new-game-item";

    var tile = document.createElement("button");
    tile.className = "game-tile";
    tile.innerHTML = '<div class="tile-icon">'+g.icon+'</div><div class="tile-label">'+g.name+'</div>';
    tile.addEventListener("click", function(){ openGame(g); });

    var fav = isFavorite(g.id);
    var heart = document.createElement("button");
    heart.className = "heart-btn" + (fav ? " filled" : "");
    heart.setAttribute("aria-label", fav ? ("Remove "+g.name+" from Favorites") : ("Save "+g.name+" to Favorites"));
    heart.innerHTML = heartSVG();
    heart.addEventListener("click", function(e){
      e.stopPropagation();
      toggleFavorite(g.id);
      renderFavorites();
      renderNewGames();
    });

    item.appendChild(tile);
    item.appendChild(heart);
    return item;
  }
  function renderFavorites(){
    var grid = document.getElementById("favoritesGrid");
    grid.innerHTML = "";
    var favGames = GAMES.filter(function(g){ return isFavorite(g.id); });
    if (favGames.length === 0){
      grid.innerHTML = '<div class="empty-note" style="grid-column:1/-1;">No favorites yet — add one from New Games.</div>';
      return;
    }
    favGames.forEach(function(g){ grid.appendChild(buildGameTile(g)); });
  }
  function renderNewGames(){
    var grid = document.getElementById("newGamesGrid");
    grid.innerHTML = "";
    var newGames = GAMES.filter(function(g){ return !isFavorite(g.id); });
    if (newGames.length === 0){
      grid.innerHTML = '<div class="empty-note" style="grid-column:1/-1;">You\'ve favorited everything here. More games coming soon.</div>';
      return;
    }
    newGames.forEach(function(g){ grid.appendChild(buildGameTile(g)); });
  }

  // ================= STATISTICS =================
  function pointsStatsFor(gameId){
    var log = store.dailyLog[gameId] || {};
    var total = 0, pctSum = 0, count = 0;
    Object.keys(log).forEach(function(date){
      var entry = log[date];
      total += entry.score;
      var maxP = entry.maxPossible !== undefined ? entry.maxPossible : (entry.details && entry.details.bestValue);
      if (maxP > 0) pctSum += (entry.score / maxP) * 100;
      count++;
    });
    return {
      total: Math.round(total),
      avgPct: count > 0 ? Math.round((pctSum / count) * 10) / 10 : 0,
      count: count
    };
  }

  function statCardHtml(num, label){
    return '<div class="stat-card"><div class="stat-num">' + num + '</div><div class="stat-label">' + label + '</div></div>';
  }
  function statCardHtmlWithSub(num, sub, label){
    return '<div class="stat-card"><div class="stat-num">' + num + '</div><div class="stat-tier-sub">' + sub + '</div><div class="stat-label">' + label + '</div></div>';
  }
  function statSectionHtml(gameId, title, cardsHtml, subtext){
    var game = GAMES.filter(function(g){ return g.id === gameId; })[0];
    var iconHtml = game ? ('<div class="stat-section-icon">' + game.icon + '</div>') : '';
    return '<div class="section-title-row">' + iconHtml + '<div class="section-title">' + title + '</div></div>'
      + '<div class="stat-row">' + cardsHtml + '</div>'
      + (subtext ? ('<p class="stat-sub">' + subtext + '</p>') : '');
  }

  // Looks up which BEE_RANKS tier the current Spelling Bee high score corresponds
  // to, using the daily-log entry that produced that high score for its max-possible.
  function beeHighestTierLabel(){
    var highScore = store.highScores.spellingbee;
    if (highScore === undefined) return BEE_RANKS[0].label;
    var log = store.dailyLog.spellingbee || {};
    var maxP = null;
    Object.keys(log).forEach(function(date){
      if (log[date].score === highScore && log[date].maxPossible) maxP = log[date].maxPossible;
    });
    if (!maxP) return BEE_RANKS[0].label;
    var pct = highScore / maxP;
    var rank = BEE_RANKS[0].label;
    BEE_RANKS.forEach(function(r){ if (pct >= r.pct) rank = r.label; });
    return rank;
  }

  // Daily Five: correctness + guess-efficiency stats (no points framing).
  function dailyFiveStats(){
    var log = store.dailyLog.dailyfive || {};
    var totalDays = 0, correctDays = 0, guessSum = 0;
    Object.keys(log).forEach(function(date){
      var entry = log[date];
      totalDays++;
      if (entry.result === "win"){
        correctDays++;
        guessSum += (entry.guesses ? entry.guesses.length : 0);
      }
    });
    return {
      totalCorrect: correctDays,
      totalDays: totalDays,
      pctCorrect: totalDays > 0 ? Math.round((correctDays/totalDays)*100) : 0,
      avgGuesses: correctDays > 0 ? Math.round((guessSum/correctDays)*10)/10 : 0
    };
  }

  // Each game gets its own clearly-labeled section — nothing is combined across games.
  function renderStats(){
    var out = "";

    // Best Move: points-based daily challenge
    var bm = pointsStatsFor("chess");
    out += statSectionHtml("chess", "Best Move",
      statCardHtml(bm.total, "Total Points") + statCardHtml(bm.avgPct + "%", "Avg % of Max"),
      bm.count > 0 ? ("Based on " + bm.count + " day" + (bm.count===1?"":"s") + " played.") : "Play to start tracking.");

    // Spelling Bee: points-based daily challenge, high score tagged with the tier it reached
    var sb = pointsStatsFor("spellingbee");
    var sbHigh = store.highScores.spellingbee !== undefined ? store.highScores.spellingbee : 0;
    out += statSectionHtml("spellingbee", "Spelling Bee",
      statCardHtml(sb.total, "Total Points") + statCardHtmlWithSub(sbHigh, beeHighestTierLabel(), "High Score") + statCardHtml(sb.avgPct + "%", "Avg % of Max"),
      sb.count > 0 ? ("Based on " + sb.count + " day" + (sb.count===1?"":"s") + " played.") : "Play to start tracking.");

    // Daily Five: correctness-focused stats
    var df5 = dailyFiveStats();
    out += statSectionHtml("dailyfive", "Daily Word",
      statCardHtml(df5.totalCorrect, "Total Correct") + statCardHtml(df5.pctCorrect + "%", "% of Days Correct") + statCardHtml(df5.avgGuesses, "Avg Guesses to Correct"),
      df5.totalDays > 0 ? ("Based on " + df5.totalDays + " day" + (df5.totalDays===1?"":"s") + " played.") : "Play to start tracking.");

    // That One Ad: high score + longest time, no points concept
    var adHigh = store.highScores.roadgame;
    var adTime = store.longestTimes.roadgame;
    if (adHigh !== undefined || adTime !== undefined){
      out += statSectionHtml("roadgame", "That One Ad",
        statCardHtml(adHigh !== undefined ? adHigh : 0, "High Score") + statCardHtml(adTime !== undefined ? fmtTime(adTime) : "0:00", "Longest Time"),
        null);
    } else {
      out += statSectionHtml("roadgame", "That One Ad", '<div class="empty-note" style="grid-column:1/-1;">Play to set your first high score.</div>', null);
    }

    // Checkers: combined W/L record, win rate, and average moves needed to win
    var wins = store.checkersRecord.wins, losses = store.checkersRecord.losses;
    var totalGames = wins + losses;
    var winPct = totalGames > 0 ? Math.round((wins/totalGames)*100) : 0;
    var avgMovesToWin = store.checkersRecord.movesTrackedWins > 0
      ? Math.round((store.checkersRecord.totalMovesInWins / store.checkersRecord.movesTrackedWins) * 10) / 10
      : 0;
    out += statSectionHtml("checkers", "Checkers",
      statCardHtml(wins + "\u2013" + losses, "W/L") + statCardHtml(winPct + "%", "Win Rate") + statCardHtml(avgMovesToWin, "Avg Moves to Win"),
      null);

    // Solitaire: win rate and fewest moves in a won game
    var solWins = store.solitaireRecord.wins, solPlayed = store.solitaireRecord.played;
    var solWinPct = solPlayed > 0 ? Math.round((solWins/solPlayed)*100) : 0;
    var solBest = store.solitaireRecord.bestMoves;
    out += statSectionHtml("solitaire", "Solitaire",
      statCardHtml(solWins, "Wins") + statCardHtml(solWinPct + "%", "Win Rate") + statCardHtml(solBest !== null ? solBest : "\u2014", "Fewest Moves to Win"),
      null);

    // Blackjack: wins/losses/pushes, plus a nod to how many naturals you've hit
    var bjWins = store.blackjackRecord.wins, bjLosses = store.blackjackRecord.losses, bjPushes = store.blackjackRecord.pushes;
    var bjTotal = bjWins + bjLosses + bjPushes;
    var bjWinPct = bjTotal > 0 ? Math.round((bjWins/bjTotal)*100) : 0;
    out += statSectionHtml("blackjack", "Blackjack",
      statCardHtml(bjWins + "\u2013" + bjLosses + "\u2013" + bjPushes, "W/L/Push") + statCardHtml(bjWinPct + "%", "Win Rate") + statCardHtml(store.blackjackRecord.blackjacks, "Blackjacks"),
      null);

    document.getElementById("statsBody").innerHTML = out;
    renderTileMatchStatsSection();
  }

  // Tile Match's stats need an interactive difficulty filter, so unlike the other
  // sections (built as a plain HTML string) this one is built as real DOM nodes with
  // working click handlers, then appended after the rest of the page is set.
  function renderTileMatchStatsSection(){
    if (!tmStatsFilter){
      tmStatsFilter = (store.settings && store.settings.tileMatchDifficulty) || "easy";
    }
    var container = document.createElement("div");

    var game = GAMES.filter(function(g){ return g.id === "tilematch"; })[0];
    var titleRow = document.createElement("div");
    titleRow.className = "section-title-row";
    titleRow.innerHTML = '<div class="stat-section-icon">' + (game ? game.icon : "") + '</div><div class="section-title">Tile Match</div>';
    container.appendChild(titleRow);

    var filterWrap = document.createElement("div");
    filterWrap.className = "theme-toggle";
    filterWrap.style.marginBottom = "10px";
    TM_DIFFICULTIES.forEach(function(d){
      var btn = document.createElement("button");
      btn.className = "theme-btn" + (tmStatsFilter === d.id ? " active" : "");
      btn.textContent = d.label;
      btn.addEventListener("click", function(){
        tmStatsFilter = d.id;
        renderStats();
      });
      filterWrap.appendChild(btn);
    });
    container.appendChild(filterWrap);

    var rec = store.tileMatchRecord[tmStatsFilter] || { played:0, bestTimeMs:null, bestPoints:0 };
    var statRow = document.createElement("div");
    statRow.className = "stat-row";
    statRow.innerHTML = statCardHtml(rec.played, "Games Played")
      + statCardHtml(rec.bestTimeMs !== null ? fmtTime(rec.bestTimeMs) : "\u2014", "Best Time")
      + statCardHtml(rec.bestPoints, "Best Points");
    container.appendChild(statRow);

    document.getElementById("statsBody").appendChild(container);
  }

  // ================= BEST MOVE (CHESS) ENGINE =================
  var PIECE_VALUES = { P:1, N:3, B:3, R:5, Q:9, K:0 };
  var PIECE_NAMES = { P:"Pawn", N:"Knight", B:"Bishop", R:"Rook", Q:"Queen", K:"King" };
  var BISHOP_DIRS = [[-1,-1],[-1,1],[1,-1],[1,1]];
  var ROOK_DIRS = [[-1,0],[1,0],[0,-1],[0,1]];
  var QUEEN_DIRS = BISHOP_DIRS.concat(ROOK_DIRS);
  var KNIGHT_OFFSETS = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];

  function initialBoard(){
    var back = ["R","N","B","Q","K","B","N","R"];
    var b = [];
    b.push(back.map(function(t){ return { color:"b", type:t }; }));
    b.push(Array(8).fill(0).map(function(){ return { color:"b", type:"P" }; }));
    for (var i=0;i<4;i++) b.push(Array(8).fill(null));
    b.push(Array(8).fill(0).map(function(){ return { color:"w", type:"P" }; }));
    b.push(back.map(function(t){ return { color:"w", type:t }; }));
    return b;
  }
  function inBounds(r,c){ return r>=0 && r<8 && c>=0 && c<8; }

  function movesForSquare(board, r, c){
    var piece = board[r][c];
    if (!piece) return [];
    var moves = [];
    var enemy = piece.color === "w" ? "b" : "w";

    if (piece.type === "P"){
      var dir = piece.color === "w" ? -1 : 1;
      var startRow = piece.color === "w" ? 6 : 1;
      if (inBounds(r+dir,c) && !board[r+dir][c]){
        moves.push({ r:r+dir, c:c, capture:false });
        if (r === startRow && !board[r+2*dir][c]){
          moves.push({ r:r+2*dir, c:c, capture:false });
        }
      }
      [-1,1].forEach(function(dc){
        var nr=r+dir, nc=c+dc;
        if (inBounds(nr,nc) && board[nr][nc] && board[nr][nc].color===enemy && board[nr][nc].type!=="K"){
          moves.push({ r:nr, c:nc, capture:true });
        }
      });
    } else if (piece.type === "N"){
      KNIGHT_OFFSETS.forEach(function(o){
        var nr=r+o[0], nc=c+o[1];
        if (!inBounds(nr,nc)) return;
        var t = board[nr][nc];
        if (!t) moves.push({ r:nr, c:nc, capture:false });
        else if (t.color===enemy && t.type!=="K") moves.push({ r:nr, c:nc, capture:true });
      });
    } else if (piece.type === "K"){
      QUEEN_DIRS.forEach(function(d){
        var nr=r+d[0], nc=d[1]+c;
        if (!inBounds(nr,nc)) return;
        var t = board[nr][nc];
        if (!t) moves.push({ r:nr, c:nc, capture:false });
        else if (t.color===enemy && t.type!=="K") moves.push({ r:nr, c:nc, capture:true });
      });
    } else {
      var dirs = piece.type === "B" ? BISHOP_DIRS : piece.type === "R" ? ROOK_DIRS : QUEEN_DIRS;
      dirs.forEach(function(d){
        var nr=r+d[0], nc=d[1]+c;
        while (inBounds(nr,nc)){
          var t = board[nr][nc];
          if (!t){ moves.push({ r:nr, c:nc, capture:false }); nr+=d[0]; nc+=d[1]; continue; }
          if (t.color===enemy && t.type!=="K") moves.push({ r:nr, c:nc, capture:true });
          break;
        }
      });
    }
    return moves;
  }

  function allMovesForColor(board, color){
    var out = [];
    for (var r=0;r<8;r++) for (var c=0;c<8;c++){
      var p = board[r][c];
      if (p && p.color===color){
        movesForSquare(board,r,c).forEach(function(m){ out.push({ fr:r, fc:c, tr:m.r, tc:m.c, capture:m.capture }); });
      }
    }
    return out;
  }

  function hashString(str){
    var h = 1779033703 ^ str.length;
    for (var i=0;i<str.length;i++){
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
  }
  function mulberry32(seed){
    return function(){
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function simulateWalk(rng, halfMoves){
    var board = initialBoard();
    var side = "w";
    for (var i=0;i<halfMoves;i++){
      var moves = allMovesForColor(board, side);
      if (moves.length === 0) break;
      var m = moves[Math.floor(rng() * moves.length)];
      board[m.tr][m.tc] = board[m.fr][m.fc];
      board[m.fr][m.fc] = null;
      side = side === "w" ? "b" : "w";
    }
    return { board:board, side:side };
  }

  function generateDailyPuzzle(dateStr){
    var baseSeed = hashString("fox-chess-" + dateStr);
    for (var attempt=0; attempt<40; attempt++){
      var rng = mulberry32((baseSeed + attempt*7919) >>> 0);
      var halfMoves = 8 + Math.floor(rng() * 10);
      if (halfMoves % 2 !== 0) halfMoves++; // force an even count so it always lands back on White to move
      var sim = simulateWalk(rng, halfMoves);
      var allMoves = allMovesForColor(sim.board, sim.side);
      var captureMoves = allMoves.filter(function(m){ return m.capture; });
      if (captureMoves.length > 0){
        var targets = {};
        captureMoves.forEach(function(m){
          var key = m.tr + "," + m.tc;
          var capturedType = sim.board[m.tr][m.tc].type;
          targets[key] = { r:m.tr, c:m.tc, type:capturedType, value:PIECE_VALUES[capturedType] };
        });
        var targetList = Object.keys(targets).map(function(k){ return targets[k]; });
        var best = targetList.reduce(function(a,b){ return b.value > a.value ? b : a; });
        return { board:sim.board, side:sim.side, targets:targetList, best:best };
      }
    }
    return null;
  }

  var chessPuzzle = null;
  var chessLocked = false;
  var selectedSquare = null;
  var previewSquare = null;

  function openChess(){
    var today = todayStr();
    var existing = (store.dailyLog.chess || {})[today];
    chessPuzzle = generateDailyPuzzle(today);
    selectedSquare = null;
    previewSquare = null;
    if (!chessPuzzle){
      document.getElementById("chessStatus").textContent = "Couldn't generate today's puzzle — try again tomorrow.";
      document.getElementById("chessBoard").innerHTML = "";
      return;
    }
    chessLocked = !!existing;
    document.getElementById("chessStatus").innerHTML = "<b>White</b> to move — find the highest-value capture.";
    if (chessLocked){
      renderChessBoard(false);
      showChessResult(existing.details.capturedType, existing.details.capturedValue, existing.details.bestType, existing.details.bestValue, true);
    } else {
      document.getElementById("chessResult").style.display = "none";
      renderChessBoard(true);
    }
  }

  function pieceGlyph(type){
    if (type === "N") return "Kn";
    return type;
  }

  function destinationsForSelected(){
    if (!selectedSquare) return [];
    return movesForSquare(chessPuzzle.board, selectedSquare.r, selectedSquare.c);
  }

  function renderChessBoard(interactive){
    var boardEl = document.getElementById("chessBoard");
    boardEl.innerHTML = "";
    var board = chessPuzzle.board;

    for (var r=0;r<8;r++){
      for (var c=0;c<8;c++){
        var sq = document.createElement("div");
        sq.className = "sq " + (((r+c)%2===0) ? "light" : "dark");
        var piece = board[r][c];
        var isSelected = selectedSquare && selectedSquare.r===r && selectedSquare.c===c;
        var isPreview = previewSquare && previewSquare.r===r && previewSquare.c===c;

        if (isPreview) sq.classList.add("dest-preview");

        if (piece){
          var pEl = document.createElement("div");
          pEl.className = "piece " + (piece.color === "b" ? "black" : "white");
          pEl.textContent = pieceGlyph(piece.type);
          if (isSelected) pEl.classList.add("selected");
          sq.appendChild(pEl);
        }

        if (interactive){
          (function(rr,cc){
            sq.addEventListener("click", function(){ handleSquareClick(rr,cc); });
          })(r,c);
        }
        boardEl.appendChild(sq);
      }
    }
  }

  function hasAnyMove(r,c){
    return movesForSquare(chessPuzzle.board, r, c).length > 0;
  }

  function handleSquareClick(r,c){
    if (chessLocked) return;
    var board = chessPuzzle.board;
    var piece = board[r][c];

    if (selectedSquare && selectedSquare.r===r && selectedSquare.c===c){
      selectedSquare = null; previewSquare = null; renderChessBoard(true); return;
    }
    if (piece && piece.color === chessPuzzle.side && hasAnyMove(r,c)){
      selectedSquare = { r:r, c:c };
      previewSquare = null;
      renderChessBoard(true);
      return;
    }
    if (selectedSquare){
      var isLegalDest = destinationsForSelected().some(function(d){ return d.r===r && d.c===c; });
      if (isLegalDest){
        if (previewSquare && previewSquare.r===r && previewSquare.c===c){
          confirmChessMove(r,c);
        } else {
          previewSquare = { r:r, c:c };
          renderChessBoard(true);
        }
        return;
      }
    }
    selectedSquare = null; previewSquare = null; renderChessBoard(true);
  }

  function confirmChessMove(r,c){
    var board = chessPuzzle.board;
    var captured = board[r][c];
    var mover = board[selectedSquare.r][selectedSquare.c];
    var best = chessPuzzle.best;
    var capturedType = captured ? captured.type : null;
    var capturedValue = captured ? PIECE_VALUES[captured.type] : 0;

    var boardEl = document.getElementById("chessBoard");
    var idx = r*8 + c;
    var sqEl = boardEl.children[idx];
    sqEl.classList.remove("dest-preview");
    sqEl.classList.add("dest-confirm");

    setTimeout(function(){
      board[r][c] = mover;
      board[selectedSquare.r][selectedSquare.c] = null;

      chessLocked = true;
      var today = todayStr();
      if (!store.dailyLog.chess) store.dailyLog.chess = {};
      store.dailyLog.chess[today] = {
        score: capturedValue,
        maxPossible: best.value,
        details: { capturedType:capturedType, capturedValue:capturedValue, bestType:best.type, bestValue:best.value }
      };
      saveStore();

      selectedSquare = null; previewSquare = null;
      renderChessBoard(false);
      showChessResult(capturedType, capturedValue, best.type, best.value, false);
    }, 300);
  }

  function showChessResult(capturedType, capturedValue, bestType, bestValue, alreadyPlayed){
    var box = document.getElementById("chessResult");
    var perfect = capturedValue >= bestValue && capturedValue > 0;
    var headline = perfect
      ? "Perfect — best capture found!"
      : capturedType
        ? ("You captured a " + PIECE_NAMES[capturedType] + " (+" + capturedValue + ")")
        : "You moved without capturing anything (+0)";
    var sub = perfect
      ? ("The " + PIECE_NAMES[capturedType] + " was worth " + capturedValue + " points — the most available today.")
      : ("The best available capture today was the " + PIECE_NAMES[bestType] + " (+" + bestValue + ").");
    box.innerHTML =
      '<div class="result-headline' + (perfect ? ' perfect' : '') + '">' + headline + '</div>' +
      '<div class="result-sub">' + sub + '</div>' +
      (alreadyPlayed ? '<div class="result-again">You already played today\'s challenge — come back tomorrow for a new one.</div>' : '');
    box.style.display = "block";
  }

  document.getElementById("chessBackBtn").addEventListener("click", function(){ showPage("favoritesPage"); });

  // ================= CHECKERS ENGINE =================
  function ckInitBoard(){
    var b = [];
    for (var r=0;r<8;r++) b.push(Array(8).fill(null));
    for (var r=0;r<3;r++){
      for (var c=0;c<8;c++){
        if ((r+c)%2===1) b[r][c] = { color:"b", king:false };
      }
    }
    for (var r=5;r<8;r++){
      for (var c=0;c<8;c++){
        if ((r+c)%2===1) b[r][c] = { color:"r", king:false };
      }
    }
    return b;
  }
  function ckInBounds(r,c){ return r>=0 && r<8 && c>=0 && c<8; }
  function ckDirs(piece){
    if (piece.king) return [[-1,-1],[-1,1],[1,-1],[1,1]];
    return piece.color === "r" ? [[-1,-1],[-1,1]] : [[1,-1],[1,1]];
  }
  function ckMovesForSquare(board, r, c){
    var piece = board[r][c];
    if (!piece) return { moves:[], captures:[] };
    var moves = [], captures = [];
    ckDirs(piece).forEach(function(d){
      var nr=r+d[0], nc=c+d[1];
      if (!ckInBounds(nr,nc)) return;
      if (!board[nr][nc]){
        moves.push({ r:nr, c:nc });
      } else if (board[nr][nc].color !== piece.color){
        var jr=nr+d[0], jc=nc+d[1];
        if (ckInBounds(jr,jc) && !board[jr][jc]){
          captures.push({ r:jr, c:jc, capR:nr, capC:nc });
        }
      }
    });
    return { moves:moves, captures:captures };
  }
  function ckAllMoves(board, color){
    var allCaptures = [], allMoves = [];
    for (var r=0;r<8;r++){
      for (var c=0;c<8;c++){
        var p = board[r][c];
        if (!p || p.color !== color) continue;
        var res = ckMovesForSquare(board, r, c);
        res.captures.forEach(function(m){ allCaptures.push({ fr:r, fc:c, r:m.r, c:m.c, capR:m.capR, capC:m.capC }); });
        res.moves.forEach(function(m){ allMoves.push({ fr:r, fc:c, r:m.r, c:m.c }); });
      }
    }
    // Captures are no longer mandatory — every legal move (capture or simple)
    // from every piece is available to choose from.
    return { captures:allCaptures, moves:allMoves };
  }
  function ckExecuteStep(board, fr, fc, tr, tc, capR, capC){
    var piece = board[fr][fc];
    board[tr][tc] = piece;
    board[fr][fc] = null;
    var captured = false;
    if (capR !== undefined && capR !== null){
      board[capR][capC] = null;
      captured = true;
    }
    if (!piece.king){
      if (piece.color === "r" && tr === 0) piece.king = true;
      if (piece.color === "b" && tr === 7) piece.king = true;
    }
    var continued = false;
    if (captured){
      var further = ckMovesForSquare(board, tr, tc).captures;
      continued = further.length > 0;
    }
    return { captured:captured, continued:continued };
  }

  var ckBoard = null;
  var ckTurn = "r";
  var ckSelected = null;
  var ckActivePiece = null;
  var ckGameOver = false;
  var ckMoveCount = 0;

  function openCheckers(){
    ckBoard = ckInitBoard();
    ckTurn = "r";
    ckSelected = null;
    ckActivePiece = null;
    ckGameOver = false;
    ckMoveCount = 0;
    document.getElementById("checkersResult").style.display = "none";
    renderCheckersBoard();
    updateCheckersStatus();
  }

  function ckPieceGlyph(piece){ return piece.king ? "★" : ""; }

  function renderCheckersBoard(){
    var boardEl = document.getElementById("checkersBoard");
    boardEl.innerHTML = "";
    var legal = null;
    if (!ckGameOver && ckTurn === "r"){
      legal = ckActivePiece
        ? { captures: ckMovesForSquare(ckBoard, ckActivePiece.r, ckActivePiece.c).captures.map(function(m){ return { fr:ckActivePiece.r, fc:ckActivePiece.c, r:m.r, c:m.c, capR:m.capR, capC:m.capC }; }), moves:[] }
        : ckAllMoves(ckBoard, "r");
    }
    var movableSquares = {};
    var destForSelected = [];
    if (legal){
      var options = legal.captures.concat(legal.moves); // captures not mandatory
      options.forEach(function(m){ movableSquares[m.fr+","+m.fc] = true; });
      if (ckSelected){
        options.forEach(function(m){
          if (m.fr === ckSelected.r && m.fc === ckSelected.c) destForSelected.push(m);
        });
      }
    }
    var destMap = {};
    destForSelected.forEach(function(m){ destMap[m.r+","+m.c] = m; });

    for (var r=0;r<8;r++){
      for (var c=0;c<8;c++){
        var sq = document.createElement("div");
        sq.className = "sq " + (((r+c)%2===0) ? "light" : "dark");
        var piece = ckBoard[r][c];
        var key = r+","+c;
        if (piece){
          var pEl = document.createElement("div");
          pEl.className = "piece " + (piece.color === "b" ? "black" : "red");
          pEl.textContent = ckPieceGlyph(piece);
          sq.appendChild(pEl);
        }
        if (ckSelected && ckSelected.r===r && ckSelected.c===c) sq.classList.add("selected");
        if (movableSquares[key] && !ckSelected) sq.classList.add("movable");
        if (destMap[key]) sq.classList.add("targetable");
        (function(rr,cc){
          sq.addEventListener("click", function(){ handleCheckersClick(rr,cc); });
        })(r,c);
        boardEl.appendChild(sq);
      }
    }
  }

  function handleCheckersClick(r,c){
    if (ckGameOver || ckTurn !== "r") return;
    var legal = ckActivePiece
      ? { captures: ckMovesForSquare(ckBoard, ckActivePiece.r, ckActivePiece.c).captures.map(function(m){ return { fr:ckActivePiece.r, fc:ckActivePiece.c, r:m.r, c:m.c, capR:m.capR, capC:m.capC }; }), moves:[] }
      : ckAllMoves(ckBoard, "r");
    var options = legal.captures.concat(legal.moves); // captures not mandatory

    if (ckSelected){
      var dest = options.filter(function(m){ return m.fr===ckSelected.r && m.fc===ckSelected.c && m.r===r && m.c===c; })[0];
      if (dest){
        var stepRes = ckExecuteStep(ckBoard, dest.fr, dest.fc, dest.r, dest.c, dest.capR, dest.capC);
        if (stepRes.captured && stepRes.continued){
          ckActivePiece = { r:dest.r, c:dest.c };
          ckSelected = { r:dest.r, c:dest.c };
        } else {
          ckActivePiece = null;
          ckSelected = null;
          ckTurn = "b";
          ckMoveCount++;
        }
        renderCheckersBoard();
        if (checkCheckersGameOver()) return;
        updateCheckersStatus();
        if (ckTurn === "b"){
          setTimeout(ckRobotTurn, 550);
        }
        return;
      }
    }
    var hasOption = options.some(function(m){ return m.fr===r && m.fc===c; });
    if (hasOption){
      ckSelected = { r:r, c:c };
      renderCheckersBoard();
    }
  }

  function ckRobotTurn(){
    if (ckGameOver) return;
    var active = null;
    var didAnything = true;
    while (didAnything){
      didAnything = false;
      var legal = active
        ? { captures: ckMovesForSquare(ckBoard, active.r, active.c).captures.map(function(m){ return { fr:active.r, fc:active.c, r:m.r, c:m.c, capR:m.capR, capC:m.capC }; }), moves:[] }
        : ckAllMoves(ckBoard, "b");
      var options = legal.captures.concat(legal.moves); // captures not mandatory
      if (options.length === 0) break;
      var pick = options[Math.floor(Math.random() * options.length)];
      var stepRes = ckExecuteStep(ckBoard, pick.fr, pick.fc, pick.r, pick.c, pick.capR, pick.capC);
      if (stepRes.captured && stepRes.continued){
        active = { r:pick.r, c:pick.c };
        didAnything = true;
      } else {
        active = null;
        didAnything = false;
      }
    }
    ckTurn = "r";
    renderCheckersBoard();
    if (checkCheckersGameOver()) return;
    updateCheckersStatus();
  }

  function checkCheckersGameOver(){
    var res = ckAllMoves(ckBoard, ckTurn);
    var hasMoves = res.captures.length > 0 || res.moves.length > 0;
    if (!hasMoves){
      ckGameOver = true;
      var winner = ckTurn === "r" ? "Robot" : "You";
      showCheckersResult(winner);
      return true;
    }
    return false;
  }

  function showCheckersResult(winner){
    var box = document.getElementById("checkersResult");
    var youWon = winner === "You";
    if (youWon){
      store.checkersRecord.wins++;
      store.checkersRecord.totalMovesInWins += ckMoveCount;
      store.checkersRecord.movesTrackedWins++;
    } else {
      store.checkersRecord.losses++;
    }
    saveStore();
    box.innerHTML =
      '<div class="result-headline' + (youWon ? ' perfect' : '') + '">' + (youWon ? "You win!" : "Robot wins") + '</div>' +
      '<div class="result-sub">' + (youWon ? "The robot ran out of legal moves." : "You ran out of legal moves — try again.") + '</div>';
    box.style.display = "block";
  }

  function updateCheckersStatus(){
    if (ckGameOver) return;
    document.getElementById("checkersStatus").innerHTML = ckTurn === "r"
      ? "<b>Your move</b> — red pieces, moving up the board."
      : "<b>Robot is thinking…</b>";
  }

  document.getElementById("checkersBackBtn").addEventListener("click", function(){ showPage("favoritesPage"); });
  document.getElementById("checkersNewGameBtn").addEventListener("click", function(){ openCheckers(); });

  // ================= SOLITAIRE (KLONDIKE) ENGINE =================
  var SUITS = ["S","H","D","C"];
  var sol = {
    tableau: [[],[],[],[],[],[],[]],
    foundations: { S:[], H:[], D:[], C:[] },
    stock: [], waste: [],
    drawCount: 1, selected: null, moves: 0, gameOver: false, won: false
  };

  function solBuildDeck(){
    var deck = [];
    SUITS.forEach(function(s){
      for (var r=1;r<=13;r++) deck.push({ suit:s, rank:r, faceUp:false });
    });
    return deck;
  }
  function solShuffle(deck){
    for (var i=deck.length-1;i>0;i--){
      var j = Math.floor(Math.random()*(i+1));
      var t=deck[i]; deck[i]=deck[j]; deck[j]=t;
    }
    return deck;
  }
  function solIsRed(card){ return card.suit==="H" || card.suit==="D"; }
  function solRankLabel(rank){
    if (rank===1) return "A";
    if (rank===11) return "J";
    if (rank===12) return "Q";
    if (rank===13) return "K";
    return String(rank);
  }
  function solSuitSymbol(suit){
    return suit==="S" ? "\u2660" : suit==="H" ? "\u2665" : suit==="D" ? "\u2666" : "\u2663";
  }

  function openSolitaire(){
    sol.drawCount = (store.settings && store.settings.solDrawCount) || 1;
    dealNewSolitaireGame();
  }

  function dealNewSolitaireGame(){
    var deck = solShuffle(solBuildDeck());
    sol.tableau = [[],[],[],[],[],[],[]];
    sol.foundations = { S:[], H:[], D:[], C:[] };
    sol.stock = [];
    sol.waste = [];
    sol.selected = null;
    sol.moves = 0;
    sol.gameOver = false;
    sol.won = false;

    for (var c=0;c<7;c++){
      for (var i=0;i<=c;i++){
        var card = deck.pop();
        card.faceUp = (i===c);
        sol.tableau[c].push(card);
      }
    }
    while (deck.length){
      var card2 = deck.pop();
      card2.faceUp = false;
      sol.stock.push(card2);
    }

    store.solitaireRecord.played++;
    saveStore();

    updateSolDrawButtons();
    document.getElementById("solResult").style.display = "none";
    renderSolitaire();
    updateSolStatus();
  }

  // ---- Rules ----
  // pile[startIndex..end] is a valid movable run if every card is face-up and each
  // subsequent card is one rank lower and the opposite color of the one before it.
  function solSequenceValid(col, startIndex){
    var pile = sol.tableau[col];
    if (startIndex<0 || startIndex>=pile.length) return false;
    if (!pile[startIndex].faceUp) return false;
    for (var i=startIndex; i<pile.length-1; i++){
      var a = pile[i], b = pile[i+1];
      if (!b.faceUp) return false;
      if (b.rank !== a.rank-1) return false;
      if (solIsRed(a) === solIsRed(b)) return false;
    }
    return true;
  }
  function solTopCardMovableToFoundation(card){
    var f = sol.foundations[card.suit];
    if (card.rank===1) return f.length===0;
    return f.length>0 && f[f.length-1].rank === card.rank-1;
  }
  function solCardMovableToTableauColumn(card, colIndex){
    var pile = sol.tableau[colIndex];
    if (pile.length===0) return card.rank===13;
    var top = pile[pile.length-1];
    if (!top.faceUp) return false;
    return top.rank === card.rank+1 && solIsRed(top) !== solIsRed(card);
  }
  function solSelectedCard(){
    if (!sol.selected) return null;
    if (sol.selected.type==="tableau"){
      var pile = sol.tableau[sol.selected.col];
      return pile[sol.selected.index] || null;
    }
    if (sol.selected.type==="waste"){
      return sol.waste.length ? sol.waste[sol.waste.length-1] : null;
    }
    return null;
  }
  function solSelectionIsSingleCard(){
    if (!sol.selected) return false;
    if (sol.selected.type==="waste") return sol.waste.length>0;
    if (sol.selected.type==="tableau"){
      var pile = sol.tableau[sol.selected.col];
      return sol.selected.index === pile.length-1;
    }
    return false;
  }
  function solColumnIsValidTarget(colIndex){
    if (!sol.selected) return false;
    if (sol.selected.type==="tableau" && sol.selected.col===colIndex) return false;
    var card = solSelectedCard();
    if (!card) return false;
    return solCardMovableToTableauColumn(card, colIndex);
  }
  function solFoundationIsValidTarget(suit){
    if (!solSelectionIsSingleCard()) return false;
    var card = solSelectedCard();
    return !!card && card.suit===suit && solTopCardMovableToFoundation(card);
  }

  function flipSolTopIfNeeded(col){
    var pile = sol.tableau[col];
    if (pile.length>0 && !pile[pile.length-1].faceUp) pile[pile.length-1].faceUp = true;
  }

  function solMoveTableauToTableau(fromCol, startIndex, toCol){
    if (fromCol===toCol) return false;
    var pile = sol.tableau[fromCol];
    var moving = pile.slice(startIndex);
    if (moving.length===0) return false;
    if (!solCardMovableToTableauColumn(moving[0], toCol)) return false;
    sol.tableau[fromCol] = pile.slice(0, startIndex);
    Array.prototype.push.apply(sol.tableau[toCol], moving);
    flipSolTopIfNeeded(fromCol);
    sol.moves++;
    return true;
  }
  function solMoveWasteToTableau(toCol){
    if (sol.waste.length===0) return false;
    var card = sol.waste[sol.waste.length-1];
    if (!solCardMovableToTableauColumn(card, toCol)) return false;
    sol.waste.pop();
    sol.tableau[toCol].push(card);
    sol.moves++;
    return true;
  }
  function solMoveToFoundation(source){
    var card;
    if (source.type==="tableau"){
      var pile = sol.tableau[source.col];
      if (pile.length===0) return false;
      card = pile[pile.length-1];
      if (!card.faceUp || !solTopCardMovableToFoundation(card)) return false;
      pile.pop();
      sol.foundations[card.suit].push(card);
      flipSolTopIfNeeded(source.col);
    } else if (source.type==="waste"){
      if (sol.waste.length===0) return false;
      card = sol.waste[sol.waste.length-1];
      if (!solTopCardMovableToFoundation(card)) return false;
      sol.waste.pop();
      sol.foundations[card.suit].push(card);
    } else return false;
    sol.moves++;
    checkSolitaireWin();
    return true;
  }
  function solDrawFromStock(){
    if (sol.gameOver) return;
    if (sol.stock.length===0){
      if (sol.waste.length===0) return;
      while (sol.waste.length){
        var c = sol.waste.pop();
        c.faceUp = false;
        sol.stock.push(c);
      }
      sol.moves++;
      return;
    }
    var n = Math.min(sol.drawCount, sol.stock.length);
    for (var i=0;i<n;i++){
      var card = sol.stock.pop();
      card.faceUp = true;
      sol.waste.push(card);
    }
    sol.moves++;
  }
  function checkSolitaireWin(){
    var total = 0;
    SUITS.forEach(function(s){ total += sol.foundations[s].length; });
    if (total === 52){
      sol.gameOver = true;
      sol.won = true;
      store.solitaireRecord.wins++;
      if (store.solitaireRecord.bestMoves === null || sol.moves < store.solitaireRecord.bestMoves){
        store.solitaireRecord.bestMoves = sol.moves;
      }
      saveStore();
    }
  }

  // ---- Interaction (tap select -> tap destination, same language as Checkers) ----
  function afterSolMove(){
    renderSolitaire();
    updateSolStatus();
    if (sol.won) showSolWinResult();
  }

  function handleSolCardTap(type, col, index){
    if (sol.gameOver) return;
    if (!sol.selected){
      if (type==="waste"){
        if (solMoveToFoundation({type:"waste"})){ afterSolMove(); return; }
        sol.selected = { type:"waste" };
        renderSolitaire();
        return;
      }
      if (type==="tableau"){
        var pile = sol.tableau[col];
        var isTopCard = index === pile.length-1;
        if (isTopCard && solMoveToFoundation({type:"tableau", col:col})){ afterSolMove(); return; }
        if (solSequenceValid(col, index)){
          sol.selected = { type:"tableau", col:col, index:index };
          renderSolitaire();
        }
        return;
      }
    } else {
      var same = (sol.selected.type===type) &&
        (type==="waste" || (sol.selected.col===col && sol.selected.index===index));
      if (same){ sol.selected = null; renderSolitaire(); return; }

      if (type==="tableau"){
        var moved = sol.selected.type==="tableau"
          ? solMoveTableauToTableau(sol.selected.col, sol.selected.index, col)
          : solMoveWasteToTableau(col);
        if (moved){ sol.selected = null; afterSolMove(); return; }
        if (solSequenceValid(col, index)){
          sol.selected = { type:"tableau", col:col, index:index };
          renderSolitaire();
          return;
        }
        sol.selected = null;
        renderSolitaire();
        return;
      }
      if (type==="waste"){
        sol.selected = sol.waste.length ? { type:"waste" } : null;
        renderSolitaire();
      }
    }
  }
  function handleSolColumnDropTap(colIndex){
    if (sol.gameOver || !sol.selected) return;
    var moved = sol.selected.type==="tableau"
      ? solMoveTableauToTableau(sol.selected.col, sol.selected.index, colIndex)
      : solMoveWasteToTableau(colIndex);
    sol.selected = null;
    if (moved) afterSolMove(); else renderSolitaire();
  }
  function handleSolFoundationTap(suit){
    if (sol.gameOver || !sol.selected) return;
    var moved = false;
    if (sol.selected.type==="tableau" && solSelectionIsSingleCard()){
      moved = solMoveToFoundation({ type:"tableau", col:sol.selected.col });
    } else if (sol.selected.type==="waste"){
      moved = solMoveToFoundation({ type:"waste" });
    }
    sol.selected = null;
    if (moved) afterSolMove(); else renderSolitaire();
  }
  function handleSolStockTap(){
    if (sol.gameOver) return;
    solDrawFromStock();
    sol.selected = null;
    renderSolitaire();
    updateSolStatus();
  }

  // ---- Hint: find one legal move (foundation moves first, then tableau shuffles,
  // then waste-to-tableau), or fall back to suggesting a draw if nothing is playable. ----
  function findSolHint(){
    if (sol.waste.length){
      var w = sol.waste[sol.waste.length-1];
      if (solTopCardMovableToFoundation(w)) return { type:"waste" };
    }
    for (var c=0;c<7;c++){
      var pile = sol.tableau[c];
      var topCard = pile[pile.length-1];
      if (pile.length && topCard.faceUp && solTopCardMovableToFoundation(topCard)){
        return { type:"tableau", col:c, index:pile.length-1 };
      }
    }
    for (var c2=0;c2<7;c2++){
      var pile2 = sol.tableau[c2];
      for (var i=0;i<pile2.length;i++){
        if (!pile2[i].faceUp || !solSequenceValid(c2,i)) continue;
        for (var t=0;t<7;t++){
          if (t===c2) continue;
          if (!solCardMovableToTableauColumn(pile2[i], t)) continue;
          // Skip a no-op-feeling suggestion: an unaccompanied King already sitting
          // alone at the bottom of its column moving to another empty column.
          if (i===0 && pile2[i].rank===13 && sol.tableau[t].length===0) continue;
          return { type:"tableau", col:c2, index:i };
        }
      }
    }
    if (sol.waste.length){
      var w2 = sol.waste[sol.waste.length-1];
      for (var t2=0;t2<7;t2++){
        if (solCardMovableToTableauColumn(w2, t2)) return { type:"waste" };
      }
    }
    return null;
  }
  function flashSolStockHint(){
    sol.selected = null;
    renderSolitaire();
    var stockEl = document.getElementById("solTopRow").children[0];
    if (stockEl){
      stockEl.classList.add("targetable");
      setTimeout(function(){ stockEl.classList.remove("targetable"); }, 1600);
    }
  }
  function handleSolHintTap(){
    if (sol.gameOver) return;
    var hint = findSolHint();
    if (hint){
      sol.selected = hint.type === "waste" ? { type:"waste" } : { type:"tableau", col:hint.col, index:hint.index };
      renderSolitaire();
    } else {
      flashSolStockHint();
    }
  }

  // ---- Rendering ----
  function updateSolStatus(){
    var el = document.getElementById("solStatus");
    el.innerHTML = sol.gameOver && sol.won
      ? ("<b>Solved!</b> " + sol.moves + " moves.")
      : ("Moves: <b>" + sol.moves + "</b>");
  }
  function updateSolDrawButtons(){
    document.getElementById("solDraw1Btn").classList.toggle("active", sol.drawCount===1);
    document.getElementById("solDraw3Btn").classList.toggle("active", sol.drawCount===3);
  }
  function showSolWinResult(){
    var box = document.getElementById("solResult");
    box.innerHTML = '<div class="result-headline perfect">Solved!</div>' +
      '<div class="result-sub">Finished in ' + sol.moves + ' moves.</div>';
    box.style.display = "block";
  }
  function buildSolCardEl(card, selectableFlag, selectedFlag){
    var el = document.createElement("div");
    el.className = "sol-card" + (card.faceUp ? (solIsRed(card) ? " red" : " black") : " facedown")
      + (selectableFlag ? " selectable" : "") + (selectedFlag ? " selected" : "");
    if (card.faceUp){
      el.innerHTML = '<div>' + solRankLabel(card.rank) + '</div><div class="sol-suit">' + solSuitSymbol(card.suit) + '</div>';
    }
    return el;
  }
  function renderSolitaire(){
    renderSolTopRow();
    renderSolTableau();
  }
  function renderSolTopRow(){
    var row = document.getElementById("solTopRow");
    row.innerHTML = "";

    var stockPile = document.createElement("div");
    stockPile.className = "sol-pile";
    if (sol.stock.length>0){
      stockPile.appendChild(buildSolCardEl({ faceUp:false }, false, false));
      var countEl = document.createElement("div");
      countEl.className = "sol-stock-count";
      countEl.textContent = String(sol.stock.length);
      stockPile.appendChild(countEl);
    } else if (sol.waste.length>0){
      var hint = document.createElement("div");
      hint.className = "sol-pile-hint";
      hint.textContent = "\u21BA";
      stockPile.appendChild(hint);
    }
    stockPile.addEventListener("click", handleSolStockTap);
    row.appendChild(stockPile);

    var wastePile = document.createElement("div");
    wastePile.className = "sol-pile";
    if (sol.waste.length>0){
      var showCount = Math.min(3, sol.waste.length);
      for (var i=showCount-1;i>=0;i--){
        var wc = sol.waste[sol.waste.length-1-i];
        var isTop = i===0;
        var wEl = buildSolCardEl(wc, isTop, isTop && sol.selected && sol.selected.type==="waste");
        wEl.style.left = ((showCount-1-i) * 14) + "%";
        wEl.style.zIndex = String(20 - i);
        if (isTop){
          wEl.addEventListener("click", function(e){ e.stopPropagation(); handleSolCardTap("waste"); });
        }
        wastePile.appendChild(wEl);
      }
    }
    row.appendChild(wastePile);

    var spacer = document.createElement("div");
    spacer.className = "sol-spacer";
    row.appendChild(spacer);

    SUITS.forEach(function(suit){
      var fPile = document.createElement("div");
      fPile.className = "sol-pile";
      var stack = sol.foundations[suit];
      if (stack.length>0){
        fPile.appendChild(buildSolCardEl(stack[stack.length-1], false, false));
      } else {
        var hint2 = document.createElement("div");
        hint2.className = "sol-pile-hint";
        hint2.textContent = solSuitSymbol(suit);
        fPile.appendChild(hint2);
      }
      if (solFoundationIsValidTarget(suit)) fPile.classList.add("targetable");
      fPile.addEventListener("click", function(){ handleSolFoundationTap(suit); });
      row.appendChild(fPile);
    });
  }
  function renderSolTableau(){
    var container = document.getElementById("solTableau");
    container.innerHTML = "";
    // Measure once, before any columns are (re)appended — measuring each column's own
    // width mid-loop is unreliable for flex:1 items, since early columns would report
    // an inflated width before their sibling columns exist to share the row with.
    var containerWidth = container.getBoundingClientRect().width || 322;
    var gap = 6;
    var colWidth = (containerWidth - gap*6) / 7;
    var cardH = colWidth / 0.7;
    var faceDownStep = cardH * 0.24;
    var faceUpStep = cardH * 0.40;
    for (var c=0;c<7;c++){
      (function(colIndex){
        var colEl = document.createElement("div");
        colEl.className = "sol-column";
        colEl.addEventListener("click", function(){ handleSolColumnDropTap(colIndex); });
        container.appendChild(colEl);

        var pile = sol.tableau[colIndex];

        if (solColumnIsValidTarget(colIndex)) colEl.classList.add("targetable");

        if (pile.length === 0){
          colEl.style.height = cardH + "px";
          return;
        }
        var top = 0;
        pile.forEach(function(card, idx){
          var selectableFlag = card.faceUp && solSequenceValid(colIndex, idx);
          var selectedFlag = !!sol.selected && sol.selected.type==="tableau" && sol.selected.col===colIndex && idx >= sol.selected.index;
          var cardEl = buildSolCardEl(card, selectableFlag, selectedFlag);
          cardEl.style.top = top + "px";
          cardEl.style.zIndex = String(idx+1);
          (function(cIdx, cardIndex){
            cardEl.addEventListener("click", function(e){
              e.stopPropagation();
              handleSolCardTap("tableau", cIdx, cardIndex);
            });
          })(colIndex, idx);
          colEl.appendChild(cardEl);
          top += card.faceUp ? faceUpStep : faceDownStep;
        });
        var lastStep = pile[pile.length-1].faceUp ? faceUpStep : faceDownStep;
        colEl.style.height = Math.max(cardH, (top - lastStep) + cardH) + "px";
      })(c);
    }
  }

  document.getElementById("solBackBtn").addEventListener("click", function(){ showPage("favoritesPage"); });
  document.getElementById("solNewGameBtn").addEventListener("click", function(){ dealNewSolitaireGame(); });
  document.getElementById("solHintBtn").addEventListener("click", handleSolHintTap);
  document.getElementById("solDraw1Btn").addEventListener("click", function(){
    sol.drawCount = 1; store.settings.solDrawCount = 1; saveStore(); updateSolDrawButtons();
  });
  document.getElementById("solDraw3Btn").addEventListener("click", function(){
    sol.drawCount = 3; store.settings.solDrawCount = 3; saveStore(); updateSolDrawButtons();
  });

  // ================= THAT ONE AD (endless dodge) =================
  var roadCanvas = document.getElementById("roadCanvas");
  var roadCtx = roadCanvas.getContext("2d");
  var roadOverlay = document.getElementById("roadOverlay");
  var roadOverlayTitle = document.getElementById("roadOverlayTitle");
  var roadOverlaySub = document.getElementById("roadOverlaySub");
  var roadOverlayButtons = document.getElementById("roadOverlayButtons");
  var roadTierPopupEl = document.getElementById("roadTierPopup");
  var roadTierPopupTimeout = null;

  var ROAD_DIFFICULTIES = [
    { id:"easy", label:"Easy", mult:1 },
    { id:"normal", label:"Normal", mult:1.25 },
    { id:"hard", label:"Hard", mult:1.5 },
    { id:"impossible", label:"Impossible", mult:1.75 }
  ];
  var ROAD_BASE_SPEED = 0.00035; // canvas-heights-per-ms at Easy

  var POWER_TYPES = [
    { kind:"speed2x",   label:"2x Speed",  bad:true  },
    { kind:"speedHalf", label:"1/2 Speed", bad:false },
    { kind:"smaller",   label:"Smaller",   bad:false },
    { kind:"larger",    label:"Larger",    bad:true  },
    { kind:"goodluck",  label:"Good Luck", bad:false },
    { kind:"badluck",   label:"Bad Luck",  bad:true  }
  ];
  // Short glyphs drawn on each power's small geometric shape (no room for full labels).
  // Power labels are now shown in full (see drawPowerShape) since the shapes are larger.

  var road = {
    running:false, gameOverFlag:false, animId:null, lastTime:0,
    canvasW:0, canvasH:0, roadX0:0, roadX1:0, roadW:0,
    charX:0, charY:0, charR:0, baseCharR:0, dragging:false,
    number:1, maxNumber:1, obstacles:[], spawnTimer:0, elapsedMs:0,
    difficulty:"easy", speedMultiplier:1, sizeMultiplier:1, rngShift:0, activePowers:[],
    wallSizeMultiplier:1, currentTier:0, lastTierNotified:0, drainTimer:null,
    roadColor:"#A9D8F0", chipParticles:[]
  };

  // Speed powerups also scale the game clock itself: 1/2 Speed halves the rate the
  // timer/tier/decay advance, 2x Speed doubles it — independent of size powerups.
  function timeScaleFromSpeedPowers(){
    var scale = 1;
    road.activePowers.forEach(function(p){
      if (p.kind === "speed2x") scale *= 2;
      if (p.kind === "speedHalf") scale *= 0.5;
    });
    return scale;
  }

  function randomRoadColor(){
    // Only blue, yellow, purple, and orange hue bands — never red or green.
    var bands = [[20,40],[45,65],[200,250],[260,290]];
    var band = bands[Math.floor(Math.random() * bands.length)];
    var hue = band[0] + Math.random() * (band[1] - band[0]);
    return "hsl(" + Math.round(hue) + ", 55%, 72%)";
  }

  function roadEffectiveSpeed(){
    var diff = ROAD_DIFFICULTIES.filter(function(d){ return d.id === road.difficulty; })[0] || ROAD_DIFFICULTIES[0];
    var tierSpeedMult = Math.pow(1.1, road.currentTier);
    return road.canvasH * ROAD_BASE_SPEED * diff.mult * road.speedMultiplier * tierSpeedMult;
  }

  function resizeCanvasRoad(){
    var rect = roadCanvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    roadCanvas.width = Math.round(rect.width * dpr);
    roadCanvas.height = Math.round(rect.height * dpr);
    road.canvasW = roadCanvas.width;
    road.canvasH = roadCanvas.height;
    road.roadW = road.canvasW * 0.8;
    road.roadX0 = road.canvasW * 0.1;
    road.roadX1 = road.roadX0 + road.roadW;
    road.baseCharR = road.roadW * 0.085;
    road.charR = road.baseCharR * road.sizeMultiplier;
    road.charY = road.canvasH - road.canvasH * 0.12;
    if (!road.charX || road.charX < road.roadX0 || road.charX > road.roadX1){
      road.charX = (road.roadX0 + road.roadX1) / 2;
    }
  }

  function resetRoadState(){
    road.number = 1;
    road.maxNumber = 1;
    road.obstacles = [];
    road.spawnTimer = 700;
    road.elapsedMs = 0;
    road.speedMultiplier = 1;
    road.sizeMultiplier = 1;
    road.rngShift = 0;
    road.wallSizeMultiplier = 1;
    road.activePowers = [];
    road.currentTier = 0;
    road.lastTierNotified = 0;
    road.drainTimer = null;
    road.roadColor = "#A9D8F0";
    road.chipParticles = [];
    road.charR = road.baseCharR;
    road.charX = (road.roadX0 + road.roadX1) / 2;
    road.gameOverFlag = false;
    road.running = false;
    road.lastTime = 0;
    document.getElementById("roadTimer").textContent = "0:00";
    document.getElementById("roadActiveBar").innerHTML = "";
    roadTierPopupEl.classList.remove("show");
    if (roadTierPopupTimeout){ clearTimeout(roadTierPopupTimeout); roadTierPopupTimeout = null; }
  }

  function showTierPopup(text, subtext){
    roadTierPopupEl.innerHTML = '<div class="tier-popup-main">' + text + '</div>'
      + (subtext ? ('<div class="tier-popup-sub">' + subtext + '</div>') : '');
    roadTierPopupEl.classList.add("show");
    if (roadTierPopupTimeout) clearTimeout(roadTierPopupTimeout);
    roadTierPopupTimeout = setTimeout(function(){ roadTierPopupEl.classList.remove("show"); }, 2200);
  }

  // Drain schedule: tier 0 = none, tier 1 (30-59s) = 1pt every 2s,
  // tier 2 (60-89s) = 1pt/s, tier 3+ = (tier-1)pts/s.
  function drainConfigForTier(tier){
    if (tier <= 0) return null;
    if (tier === 1) return { interval:2000, amount:1 };
    return { interval:1000, amount: tier - 1 };
  }

  // Every 30s: bumps the tier (popup + compounding 1.1x speed), reshuffles the road color,
  // and drives the drain cadence above. dt is the frame's (game-clock-scaled) delta time in ms.
  function updateRoadTier(dt){
    var currentSec = Math.floor(road.elapsedMs / 1000);
    var tier = Math.floor(currentSec / 30);
    var tierChanged = tier !== road.currentTier;
    road.currentTier = tier;

    if (tier > road.lastTierNotified){
      road.lastTierNotified = tier;
      showTierPopup((tier * 30) + "s!", "Accelerated growth potential and faster decay");
    }
    if (tierChanged){
      road.roadColor = randomRoadColor();
    }

    var cfg = drainConfigForTier(tier);
    if (!cfg){
      road.drainTimer = null;
      return;
    }
    if (road.drainTimer === null || tierChanged){
      road.drainTimer = cfg.interval;
    }
    road.drainTimer -= dt;
    var guard = 0;
    while (road.drainTimer <= 0 && guard < 20){
      road.number -= cfg.amount;
      spawnChipParticles(road.charX, road.charY, 4 + Math.floor(Math.random()*3));
      road.drainTimer += cfg.interval;
      guard++;
      if (road.number < 1){ triggerRoadGameOver("drain"); break; }
    }
  }

  // ---- Decay chip particles: small triangles that flake off the character and fall
  // off the bottom of the screen, blinking in rhythm with the decay tick. The character
  // circle itself is never altered — this is a separate overlay effect. ----
  function spawnChipParticles(cx, cy, count){
    for (var i=0;i<count;i++){
      road.chipParticles.push({
        x: cx + (Math.random()-0.5) * road.charR * 1.3,
        y: cy + (Math.random()-0.5) * road.charR * 0.7,
        vx: road.canvasW * (Math.random()-0.5) * 0.00035,
        vy: road.canvasH * (0.00035 + Math.random()*0.00035),
        size: road.charR * (0.16 + Math.random()*0.12),
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random()-0.5) * 0.008,
        born: road.elapsedMs,
        life: 1200 + Math.random()*600
      });
    }
  }
  function updateChipParticles(dt){
    road.chipParticles.forEach(function(p){
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    });
    road.chipParticles = road.chipParticles.filter(function(p){
      return (road.elapsedMs - p.born) < p.life && p.y < road.canvasH + 40;
    });
  }
  function drawChipParticles(ctx){
    road.chipParticles.forEach(function(p){
      var age = road.elapsedMs - p.born;
      var blinkOn = Math.floor(age/180) % 2 === 0;
      if (!blinkOn) return;
      var fadeStart = p.life * 0.7;
      var alpha = age > fadeStart ? Math.max(0, 1 - (age-fadeStart)/(p.life-fadeStart)) : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = "#E2793D";
      ctx.beginPath();
      ctx.moveTo(0, -p.size);
      ctx.lineTo(p.size*0.87, p.size*0.5);
      ctx.lineTo(-p.size*0.87, p.size*0.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });
  }

  function randInt(min, max){
    if (max < min){ var t = min; min = max; max = t; }
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // ---- Luck stacking math ----
  // 1 active Good/Bad Luck: flat +2 / -2 shift, as before.
  // 2+ active of the SAME kind: instead of a bigger flat shift, positives/negatives get
  // multiplied or divided (rounded), per the spec:
  //  - 2+ Good Luck: positive doors x2 (tagged "x"), negative doors /2 (softened, not tagged)
  //  - 2+ Bad Luck:  negative doors x2 (tagged "x"), positive doors /2 (softened, not tagged)
  function countActiveLuck(){
    var good = 0, bad = 0;
    road.activePowers.forEach(function(p){
      if (p.kind === "goodluck") good++;
      if (p.kind === "badluck") bad++;
    });
    return { good:good, bad:bad };
  }
  function computeLuckDelta(rawDelta, goodCount, badCount){
    if (goodCount >= 2 || badCount >= 2){
      if (rawDelta > 0){
        if (goodCount >= 2) return { delta: Math.round(rawDelta*2), doubled:true };
        if (badCount >= 2)  return { delta: Math.round(rawDelta/2), doubled:false };
      } else if (rawDelta < 0){
        if (badCount >= 2)  return { delta: Math.round(rawDelta*2), doubled:true };
        if (goodCount >= 2) return { delta: Math.round(rawDelta/2), doubled:false };
      }
      return { delta: rawDelta, doubled:false };
    }
    var shift = goodCount*2 - badCount*2;
    return { delta: rawDelta + shift, doubled:false };
  }
  function applyLuckToDoor(door){
    var counts = countActiveLuck();
    var r = computeLuckDelta(door.rawDelta, counts.good, counts.bad);
    door.delta = r.delta;
    door.doubled = r.doubled;
    door.color = colorForDelta(door.delta);
  }
  function refreshAllDoorsForLuck(){
    road.obstacles.forEach(function(o){
      if (o.type === "bonus" && !o.resolved) applyLuckToDoor(o);
    });
  }

  function wallXRangeForLane(lane, sizeMult){
    var laneW = road.roadW / 3;
    var laneX0 = road.roadX0 + lane*laneW;
    var laneCenter = laneX0 + laneW/2;
    var halfW = (laneW * sizeMult) / 2;
    return { x0: laneCenter - halfW, x1: laneCenter + halfW };
  }
  function refreshAllWallSizes(){
    var counts = countActiveLuck();
    var net = counts.good - counts.bad;
    road.wallSizeMultiplier = net > 0 ? 0.5 : net < 0 ? 1.25 : 1;
    road.obstacles.forEach(function(o){
      if (o.type === "wall" && o.lane !== undefined){
        var r = wallXRangeForLane(o.lane, road.wallSizeMultiplier);
        o.x0 = r.x0; o.x1 = r.x1;
      }
    });
  }

  var MAX_ROAD_OBSTACLES = 5;

  // AABB overlap check against everything already on screen, with generous fixed
  // padding (not just item size) so items spawn with real breathing room between
  // them rather than merely not technically touching.
  function roadSpaceIsFree(x0, x1, y, h){
    var padX = road.roadW * 0.10;
    var padY = Math.max(road.canvasH * 0.14, h * 1.2);
    var qx0 = x0 - padX, qx1 = x1 + padX;
    var qy0 = y - padY, qy1 = y + h + padY;
    return !road.obstacles.some(function(o){
      var oy0 = o.y - padY, oy1 = o.y + o.h + padY;
      var xOverlap = qx0 < o.x1 && qx1 > o.x0;
      var yOverlap = qy0 < oy1 && qy1 > oy0;
      return xOverlap && yOverlap;
    });
  }

  function spawnRoadObject(){
    if (road.obstacles.length >= MAX_ROAD_OBSTACLES) return;
    var laneW = road.roadW / 3;
    var roll = Math.random();
    if (roll < 0.30){
      // bonus door pair — the raw (pre-luck) value is rolled and locked in at spawn;
      // the displayed/applied delta is derived from that raw value plus whatever Luck
      // powers are active right now, and gets refreshed live if Luck state changes.
      if (road.obstacles.length > MAX_ROAD_OBSTACLES - 2) return;
      var h = road.canvasH * 0.07;
      if (!roadSpaceIsFree(road.roadX0, road.roadX1, -h, h)) return;
      var greenLeft = Math.random() < 0.5;
      var tierMult = 1 + 0.5 * road.currentTier;
      var rawGreen = randInt(Math.round(1*tierMult), Math.round(5*tierMult));
      var rawRed = randInt(Math.round(-5*tierMult), Math.round(-1*tierMult));
      var doorA = { type:"bonus", rawDelta: greenLeft ? rawGreen : rawRed, x0:road.roadX0, x1:road.roadX0 + road.roadW/2, y:-h, h:h, resolved:false };
      var doorB = { type:"bonus", rawDelta: greenLeft ? rawRed : rawGreen, x0:road.roadX0 + road.roadW/2, x1:road.roadX1, y:-h, h:h, resolved:false };
      applyLuckToDoor(doorA);
      applyLuckToDoor(doorB);
      road.obstacles.push(doorA, doorB);
    } else if (roll < 0.30 + 0.20){
      // power pickup — a large unique geometric shape per power type, half a lane
      // column wide, labeled clearly so it's obvious what it does.
      var pt = POWER_TYPES[Math.floor(Math.random() * POWER_TYPES.length)];
      var lane = Math.floor(Math.random() * 3);
      var shapeW = laneW / 2;
      var laneCenterX = road.roadX0 + lane*laneW + laneW/2;
      var px0 = laneCenterX - shapeW/2, px1 = laneCenterX + shapeW/2;
      if (!roadSpaceIsFree(px0, px1, -shapeW, shapeW)) return;
      road.obstacles.push({
        type:"power", kind:pt.kind, label:pt.label, bad:pt.bad,
        x0: px0, x1: px1,
        y:-shapeW, h:shapeW, resolved:false
      });
    } else if (roll < 0.30 + 0.20 + 0.25){
      // barbed-wire bush hazard — a third the size of a plain wall, hollow/no icon.
      // Colliding subtracts from the character's number instead of ending the run
      // outright; the subtraction escalates every 30s (1, then 2 at 30s, 3 at 60s...).
      var laneS = Math.floor(Math.random() * 3);
      var spikeW = laneW / 3;
      var laneCenterS = road.roadX0 + laneS*laneW + laneW/2;
      var sx0 = laneCenterS - spikeW/2, sx1 = laneCenterS + spikeW/2;
      var hS = (road.canvasH * 0.05) / 3 * 2;
      if (!roadSpaceIsFree(sx0, sx1, -hS, hS)) return;
      road.obstacles.push({
        type:"spike", x0: sx0, x1: sx1,
        y:-hS, h:hS, resolved:false
      });
    } else {
      // plain hazard wall — still ends the run outright on contact
      var lane2 = Math.floor(Math.random() * 3);
      var h3 = road.canvasH * 0.05;
      var wr = wallXRangeForLane(lane2, road.wallSizeMultiplier);
      if (!roadSpaceIsFree(wr.x0, wr.x1, -h3, h3)) return;
      road.obstacles.push({ type:"wall", lane:lane2, x0:wr.x0, x1:wr.x1, y:-h3, h:h3 });
    }
  }

  function colorForDelta(delta){
    return delta > 0 ? "green" : delta < 0 ? "red" : "neutral";
  }

  function roadOverlapY(obj){
    return obj.y + obj.h >= road.charY - road.charR && obj.y <= road.charY + road.charR;
  }

  // Power-ups/downs last 7s each and genuinely stack: each pickup is its own timed entry,
  // so two overlapping "2x Speed" pickups multiply to 4x until the earlier one expires.
  // Good/Bad Luck additionally re-derive every on-screen door and wall instantly.
  function applyRoadPower(kind){
    var pt = POWER_TYPES.filter(function(p){ return p.kind === kind; })[0];
    road.activePowers.push({ kind:kind, label:pt.label, bad:pt.bad, expiresAt: road.elapsedMs + 7000 });
    if (kind === "goodluck" || kind === "badluck"){
      refreshAllDoorsForLuck();
      refreshAllWallSizes();
    }
    recomputeRoadPowers();
  }

  function recomputeRoadPowers(){
    road.activePowers = road.activePowers.filter(function(p){ return p.expiresAt > road.elapsedMs; });
    var speedMult = 1, sizeMult = 1;
    road.activePowers.forEach(function(p){
      if (p.kind === "speed2x") speedMult *= 2;
      if (p.kind === "speedHalf") speedMult *= 0.5;
      if (p.kind === "smaller") sizeMult *= 0.7;
      if (p.kind === "larger") sizeMult *= 1.4;
    });
    road.speedMultiplier = speedMult;
    road.sizeMultiplier = sizeMult;
    road.charR = road.baseCharR * road.sizeMultiplier;
    var counts = countActiveLuck();
    road.rngShift = counts.good*2 - counts.bad*2; // kept for reference/back-compat only; doors use computeLuckDelta directly
    refreshAllWallSizes();
  }

  function renderActivePowersBar(){
    var bar = document.getElementById("roadActiveBar");
    bar.innerHTML = "";
    road.activePowers.forEach(function(p){
      var secsLeft = Math.max(0, Math.ceil((p.expiresAt - road.elapsedMs) / 1000));
      var chip = document.createElement("div");
      chip.className = "road-power-chip " + (p.bad ? "bad" : "good");
      chip.innerHTML = '<span>' + p.label + '</span><span class="chip-time">' + secsLeft + 's</span>';
      bar.appendChild(chip);
    });
  }

  function updateRoadObstacles(dt){
    var speed = roadEffectiveSpeed();
    road.obstacles.forEach(function(obj){
      obj.y += speed * dt;
      if (road.gameOverFlag) return;
      var xOverlap = (road.charX + road.charR > obj.x0) && (road.charX - road.charR < obj.x1);
      if (obj.type === "wall"){
        if (xOverlap && roadOverlapY(obj)) triggerRoadGameOver("wall");
      } else if (obj.type === "spike"){
        if (!obj.resolved && xOverlap && roadOverlapY(obj)){
          obj.resolved = true;
          var subtractAmount = road.currentTier + 1;
          road.number -= subtractAmount;
          spawnChipParticles(road.charX, road.charY, 3 + Math.floor(Math.random()*2));
          if (road.number < 1) triggerRoadGameOver("spike");
        }
      } else if (obj.type === "power"){
        if (!obj.resolved && xOverlap && roadOverlapY(obj)){
          obj.resolved = true;
          applyRoadPower(obj.kind);
        }
      } else {
        if (!obj.resolved && xOverlap && roadOverlapY(obj)){
          obj.resolved = true;
          road.number += obj.delta;
          if (road.number > road.maxNumber) road.maxNumber = road.number;
          if (road.number < 1) triggerRoadGameOver("number");
        }
      }
    });
    road.obstacles = road.obstacles.filter(function(o){ return o.y <= road.canvasH + 40; });
  }

  function drawSkullIcon(ctx, cx, cy, s, bgColor){
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(cx, cy - s*0.15, s*0.38, 0, Math.PI*2);
    ctx.fill();
    var jw = s*0.5, jh = s*0.32, jy = cy + s*0.05;
    ctx.beginPath();
    ctx.moveTo(cx - jw/2, jy);
    ctx.lineTo(cx + jw/2, jy);
    ctx.lineTo(cx + jw/2 - s*0.06, jy + jh);
    ctx.lineTo(cx - jw/2 + s*0.06, jy + jh);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = bgColor;
    ctx.beginPath(); ctx.arc(cx - s*0.16, cy - s*0.15, s*0.11, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + s*0.16, cy - s*0.15, s*0.11, 0, Math.PI*2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx, cy - s*0.02);
    ctx.lineTo(cx - s*0.05, cy + s*0.08);
    ctx.lineTo(cx + s*0.05, cy + s*0.08);
    ctx.closePath();
    ctx.fill();
  }

  // A tangled barbed-wire bush — hollow black loops with a barbed wire strand crossing
  // through, no icon. A third the size of a full wall.
  function drawHollowSpike(ctx, obj){
    var cx = (obj.x0 + obj.x1) / 2;
    var cy = obj.y + obj.h / 2;
    var r = (obj.x1 - obj.x0) / 2;
    ctx.strokeStyle = "#161616";
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1.1, r * 0.13);
    var loops = 3;
    for (var i=0;i<loops;i++){
      var ang = (i/loops) * Math.PI*2 + 0.4;
      var lx = cx + Math.cos(ang) * r * 0.22;
      var ly = cy + Math.sin(ang) * r * 0.18;
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.ellipse(0, 0, r*0.6, r*0.4, 0, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }
    // barbed wire strand across the bush, with small X-shaped barbs
    ctx.beginPath();
    ctx.moveTo(cx - r*0.9, cy + r*0.1);
    ctx.lineTo(cx + r*0.9, cy - r*0.1);
    ctx.stroke();
    var barbCount = 3;
    for (var j=0;j<barbCount;j++){
      var t = j/(barbCount-1);
      var bx = (cx - r*0.7) + t*(r*1.4);
      var by = (cy + r*0.07) - t*(r*0.14);
      ctx.beginPath();
      ctx.moveTo(bx - r*0.14, by - r*0.14); ctx.lineTo(bx + r*0.14, by + r*0.14);
      ctx.moveTo(bx - r*0.14, by + r*0.14); ctx.lineTo(bx + r*0.14, by - r*0.14);
      ctx.stroke();
    }
  }

  function drawStarPath(ctx, cx, cy, outerR, innerR, points){
    var step = Math.PI / points;
    for (var i=0;i<points*2;i++){
      var r = (i % 2 === 0) ? outerR : innerR;
      var ang = -Math.PI/2 + i*step;
      var px = cx + r*Math.cos(ang), py = cy + r*Math.sin(ang);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  // Each power type gets its own large unique geometric shape (half a lane column wide)
  // with a clear multi-line label of what it does.
  function drawPowerShape(ctx, obj){
    var cx = (obj.x0 + obj.x1) / 2;
    var cy = obj.y + obj.h / 2;
    var r = (obj.x1 - obj.x0) / 2;
    ctx.fillStyle = obj.bad ? "#7A1F1F" : "#1F5C33";
    ctx.beginPath();
    if (obj.kind === "speed2x"){
      ctx.moveTo(cx, cy-r); ctx.lineTo(cx+r*0.87, cy+r*0.6); ctx.lineTo(cx-r*0.87, cy+r*0.6); ctx.closePath();
    } else if (obj.kind === "speedHalf"){
      ctx.moveTo(cx, cy+r); ctx.lineTo(cx+r*0.87, cy-r*0.6); ctx.lineTo(cx-r*0.87, cy-r*0.6); ctx.closePath();
    } else if (obj.kind === "smaller"){
      ctx.moveTo(cx, cy-r); ctx.lineTo(cx+r, cy); ctx.lineTo(cx, cy+r); ctx.lineTo(cx-r, cy); ctx.closePath();
    } else if (obj.kind === "larger"){
      for (var i=0;i<5;i++){
        var ang = -Math.PI/2 + i*(Math.PI*2/5);
        var px = cx + r*Math.cos(ang), py = cy + r*Math.sin(ang);
        if (i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
      }
      ctx.closePath();
    } else if (obj.kind === "goodluck"){
      drawStarPath(ctx, cx, cy, r, r*0.45, 5);
    } else if (obj.kind === "badluck"){
      for (var j=0;j<6;j++){
        var ang2 = -Math.PI/2 + j*(Math.PI*2/6);
        var px2 = cx + r*Math.cos(ang2), py2 = cy + r*Math.sin(ang2);
        if (j===0) ctx.moveTo(px2,py2); else ctx.lineTo(px2,py2);
      }
      ctx.closePath();
    } else {
      ctx.rect(obj.x0, obj.y, obj.x1-obj.x0, obj.h);
    }
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold " + Math.max(8, Math.round(r*0.26)) + "px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var words = obj.label.split(" ");
    if (words.length > 1){
      ctx.fillText(words[0], cx, cy - r*0.16);
      ctx.fillText(words.slice(1).join(" "), cx, cy + r*0.16);
    } else {
      ctx.fillText(obj.label, cx, cy);
    }
  }

  function drawSpikeWall(ctx, obj){
    var bg = "#161616";
    ctx.fillStyle = bg;
    ctx.fillRect(obj.x0, obj.y, obj.x1 - obj.x0, obj.h);
    var spikes = 6;
    var spikeW = (obj.x1 - obj.x0) / spikes;
    var spikeH = obj.h * 0.5;
    ctx.beginPath();
    for (var i = 0; i < spikes; i++){
      var xa = obj.x0 + i*spikeW, xb = xa + spikeW/2, xc = xa + spikeW;
      ctx.moveTo(xa, obj.y);
      ctx.lineTo(xb, obj.y - spikeH);
      ctx.lineTo(xc, obj.y);
    }
    ctx.closePath();
    ctx.fill();
    drawSkullIcon(ctx, (obj.x0+obj.x1)/2, obj.y + obj.h*0.55, obj.h*0.85, bg);
  }

  function drawRoad(){
    var ctx = roadCtx;
    ctx.clearRect(0, 0, road.canvasW, road.canvasH);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, road.canvasW, road.canvasH);
    ctx.fillStyle = road.roadColor || "#A9D8F0";
    ctx.fillRect(road.roadX0, 0, road.roadW, road.canvasH);

    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = Math.max(2, road.roadW * 0.01);
    ctx.setLineDash([14, 14]);
    [1,2].forEach(function(i){
      var x = road.roadX0 + (road.roadW/3) * i;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, road.canvasH); ctx.stroke();
    });
    ctx.setLineDash([]);

    road.obstacles.forEach(function(obj){
      if (obj.type === "wall"){
        drawSpikeWall(ctx, obj);
      } else if (obj.type === "spike"){
        drawHollowSpike(ctx, obj);
      } else if (obj.type === "power"){
        drawPowerShape(ctx, obj);
      } else {
        var boxFill = obj.color === "green" ? "#3EA35A" : obj.color === "red" ? "#D14343" : "#FFFFFF";
        ctx.globalAlpha = obj.color === "neutral" ? 0.4 : 0.55;
        ctx.fillStyle = boxFill;
        ctx.fillRect(obj.x0, obj.y, obj.x1 - obj.x0, obj.h);
        ctx.globalAlpha = 1;
        ctx.fillStyle = obj.color === "neutral" ? "#333333" : "#FFFFFF";
        ctx.font = "bold " + Math.max(10, Math.round(road.roadW*(obj.doubled ? 0.042 : 0.05))) + "px -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        var sign = obj.delta > 0 ? "+" : "";
        var label = (obj.doubled ? "x" : "") + sign + obj.delta;
        ctx.fillText(label, (obj.x0+obj.x1)/2, obj.y + obj.h/2);
      }
    });

    ctx.beginPath();
    ctx.arc(road.charX, road.charY, road.charR, 0, Math.PI*2);
    ctx.fillStyle = "#E2793D";
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold " + Math.round(road.charR*0.95) + "px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(road.number), road.charX, road.charY);

    drawChipParticles(ctx);
  }

  function roadLoop(ts){
    if (!road.running) return;
    var dt = road.lastTime ? (ts - road.lastTime) : 16;
    road.lastTime = ts;
    var gameDt = dt * timeScaleFromSpeedPowers();
    road.elapsedMs += gameDt;
    document.getElementById("roadTimer").textContent = fmtTime(road.elapsedMs);
    updateRoadTier(gameDt);
    if (road.gameOverFlag) return;
    recomputeRoadPowers();
    renderActivePowersBar();
    road.spawnTimer -= dt;
    if (road.spawnTimer <= 0){
      spawnRoadObject();
      if (Math.random() < 0.45) spawnRoadObject();
      if (Math.random() < 0.15) spawnRoadObject();
      road.spawnTimer = 550 + Math.random()*350;
    }
    updateRoadObstacles(dt);
    updateChipParticles(dt);
    drawRoad();
    if (road.running) road.animId = requestAnimationFrame(roadLoop);
  }

  function showRoadOverlay(title, sub){
    roadOverlayTitle.textContent = title;
    roadOverlaySub.textContent = sub;
    roadOverlay.classList.remove("hide");
  }
  function hideRoadOverlay(){ roadOverlay.classList.add("hide"); }

  function startRoadRun(){
    resetRoadState();
    hideRoadOverlay();
    road.running = true;
    road.animId = requestAnimationFrame(roadLoop);
  }

  function showRoadDifficultyPicker(){
    roadOverlayButtons.innerHTML = "";
    var row = document.createElement("div");
    row.className = "road-diff-row";
    ROAD_DIFFICULTIES.forEach(function(d){
      var btn = document.createElement("button");
      btn.className = "road-diff-btn" + (road.difficulty === d.id ? " selected" : "");
      btn.textContent = d.label;
      btn.addEventListener("click", function(){
        road.difficulty = d.id;
        store.settings.roadDifficulty = d.id;
        saveStore();
        startRoadRun();
      });
      row.appendChild(btn);
    });
    roadOverlayButtons.appendChild(row);
    showRoadOverlay("That One Ad", "Drag left and right. Avoid black walls. Green adds, red subtracts — don't drop below 1. Choose a speed:");
  }

  function triggerRoadGameOver(reason){
    if (road.gameOverFlag) return;
    road.gameOverFlag = true;
    road.running = false;
    if (road.animId){ cancelAnimationFrame(road.animId); road.animId = null; }
    var prevBest = store.highScores.roadgame || 0;
    var isNewBest = road.maxNumber > prevBest;
    if (isNewBest){ store.highScores.roadgame = road.maxNumber; }
    var prevLongest = store.longestTimes.roadgame || 0;
    var isNewLongest = road.elapsedMs > prevLongest;
    if (isNewLongest){ store.longestTimes.roadgame = road.elapsedMs; }
    if (isNewBest || isNewLongest) saveStore();
    var reasonText = reason === "wall" ? "You hit a wall."
      : reason === "spike" ? "A spike chipped you down to nothing."
      : reason === "drain" ? "The drain wore you down."
      : "Your number dropped below 1.";
    var bestNow = store.highScores.roadgame || road.maxNumber;
    var timeText = "Time: " + fmtTime(road.elapsedMs) + (isNewLongest ? " — new longest run!" : "");

    roadOverlayButtons.innerHTML = "";
    var row = document.createElement("div");
    row.className = "road-choice-row";
    var again = document.createElement("button");
    again.className = "road-choice-btn primary";
    again.textContent = "Play again at current speed";
    again.addEventListener("click", startRoadRun);
    var menu = document.createElement("button");
    menu.className = "road-choice-btn secondary";
    menu.textContent = "Return to menu";
    menu.addEventListener("click", function(){ showPage("favoritesPage"); });
    row.appendChild(again);
    row.appendChild(menu);
    roadOverlayButtons.appendChild(row);

    showRoadOverlay(
      "Game Over",
      reasonText + " Reached " + road.maxNumber + (isNewBest ? " — new high score!" : (" — best: " + bestNow)) + ". " + timeText
    );
  }

  function openRoadGame(){
    road.difficulty = (store.settings && store.settings.roadDifficulty) || "easy";
    resizeCanvasRoad();
    resetRoadState();
    drawRoad();
    showRoadDifficultyPicker();
  }

  function stopRoadGame(){
    road.running = false;
    if (road.animId){ cancelAnimationFrame(road.animId); road.animId = null; }
  }

  document.getElementById("roadBackBtn").addEventListener("click", function(){ showPage("favoritesPage"); });

  function roadPointerToX(e){
    var rect = roadCanvas.getBoundingClientRect();
    var clientX = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
    var relX = (clientX - rect.left) / rect.width;
    return relX * road.canvasW;
  }
  function updateCharFromEvent(e){
    var x = roadPointerToX(e);
    road.charX = Math.max(road.roadX0 + road.charR, Math.min(road.roadX1 - road.charR, x));
  }
  roadCanvas.addEventListener("pointerdown", function(e){ if (!road.running) return; road.dragging = true; updateCharFromEvent(e); e.preventDefault(); });
  roadCanvas.addEventListener("pointermove", function(e){ if (road.dragging) updateCharFromEvent(e); });
  window.addEventListener("pointerup", function(){ road.dragging = false; });
  window.addEventListener("resize", function(){
    if (document.getElementById("roadPage").classList.contains("active")){
      resizeCanvasRoad();
      drawRoad();
    }
  });


  // ================= SPELLING BEE ENGINE =================
  // 60 daily puzzles, each dictionary-validated offline (built from a real English
  // word list) with a guaranteed pangram and at least 2 vowels among the 7 letters.
  var BEE_PUZZLES = [{"center":"o","others":["e","h","m","n","r","w"],"words":["error","hero","heron","home","homeowner","homer","homeroom","hone","honor","hormone","horn","horror","memo","meow","mono","moon","moor","more","morn","moron","morrow","mower","mown","neon","none","noon","norm","nowhere","omen","owner","renown","room","roomer","rower","whereon","whom","whore","women","wooer","wore","worm","worn"]},{"center":"e","others":["c","d","n","o","v","y"],"words":["cede","ceded","cocooned","codded","code","coded","coed","concede","conceded","condone","condoned","cone","conned","convene","convened","convey","conveyed","convoyed","cooed","cove","coven","covey","dded","decency","decode","decoded","decoy","decoyed","deed","deeded","deny","done","donned","dove","doyen","dyed","eddy","encode","encoded","ended","envoy","envy","even","evened","eyed","need","needed","needy","neocon","neon","nodded","node","nonce","none","once","oven","vend","vended","voodooed"]},{"center":"s","others":["c","i","l","m","r","u"],"words":["circus","cirrus","crisis","culls","cums","cumulus","curls","curriculums","curs","cuss","ills","illus","iris","isms","lulls","mills","mils","mimics","misc","miss","mucus","mulls","murmurs","music","musics","muss","muumuus","rills","rims","rums","scull","sculls","scum","scums","sics","sill","sills","sims","sirs","slim","slims","slum","slums","slur","slurs","sums"]},{"center":"n","others":["b","c","g","i","m","o"],"words":["binging","bingo","binning","bionic","bobbin","bobbing","bogging","bogon","bombing","bonbon","bong","bonging","bongo","boning","boobing","booing","booming","boon","cocoon","cocooning","coin","coining","combing","combining","coming","common","conic","conning","cooing","coon","gibbon","gibing","gigging","ginning","gobbing","going","gong","gonging","goon","icing","icon","imbibing","incing","incoming","inning","miming","mincing","mini","minim","mining","minion","mobbing","mono","mooing","moon","mooning","nimbi","noggin","noncom","noon","oncoming","ongoing","onion"]},{"center":"e","others":["a","f","n","o","p","r"],"words":["aeon","appear","area","arena","earn","earner","error","fanfare","fare","fear","fern","fore","forenoon","free","freer","nape","near","nearer","neon","neoprene","none","nope","offer","open","opener","opera","paean","pane","paper","pare","pear","peep","peeper","peer","pennon","peon","pepper","pone","poorer","pope","pore","preen","prefer","prep","prepare","profane","proffer","prone","propane","proper","properer","rape","rapper","rare","rarer","reap","reaper","reappear","rear","reef","reefer","refer","referee","reopen","reproof","reran","roofer","rope"]},{"center":"s","others":["c","e","i","k","m","y"],"words":["ekes","emcees","eyes","ices","isms","keys","kicks","kiss","kisses","memes","mess","messes","messy","mickeys","mikes","mimes","mimics","misc","miss","misses","secs","secy","seek","seeks","seem","seems","sees","seismic","semi","semis","sick","sicks","sics","sims","sises","sissies","sissy","skies","skim","skims","skis","yeses"]},{"center":"i","others":["c","g","h","n","t","u"],"words":["chic","chichi","chin","chinning","chit","chitin","chugging","cinch","cinching","citing","cuing","cunning","cutting","gigging","ginning","gunning","gutting","high","hing","hinging","hint","hinting","hitch","hitching","hitting","hugging","hunching","hunting","icing","igniting","inch","inching","incing","inciting","inning","intuit","intuiting","itch","itching","nigh","night","ninth","nutting","thigh","thin","thing","thinning","tight","ting","tinging","tinning","tint","tinting","tithing","tugging","tunic","tuning","unhinging","unhitch","unhitching","unit","uniting"]},{"center":"e","others":["d","i","n","o","u","z"],"words":["dded","deed","deeded","denied","denizen","denude","denuded","died","dine","dined","dinned","diode","dizzied","done","donned","doze","dozed","dozen","dude","duded","dune","dunned","eddied","ended","endue","endued","ennui","indeed","indue","indued","innuendo","iodine","iodize","iodized","ionize","ionized","need","needed","neon","nine","nodded","node","none","nude","ooze","oozed","ozone","undone","undue","unionize","unionized","unneeded","zenned","zone","zoned"]},{"center":"o","others":["a","d","i","n","p","r"],"words":["adorn","airdrop","andiron","android","anion","anon","apron","ardor","dado","dodo","donor","doodad","door","droid","droop","drop","indoor","inroad","ipod","iron","noon","odor","onion","opinion","opioid","ordain","paranoia","paranoid","pardon","piano","pinion","podia","pond","poniard","poop","poor","poppa","porn","porno","prior","prod","pron","prop","radio","radon","raindrop","road","roan","roar","rood"]},{"center":"e","others":["c","f","l","s","u","y"],"words":["cell","cells","clef","clefs","clue","clueless","clues","cues","cusses","cycle","cycles","eels","ells","else","eyeful","eyefuls","eyes","feces","feel","feels","fees","fell","fells","flee","fleece","fleeces","fleecy","flees","flue","flues","fuel","fuels","fuse","fuses","fusses","lees","less","lessee","lessees","scuffle","scuffles","secs","secy","sees","self","selfless","selflessly","sell","sells","slue","slues","success","successes","successful","successfully","sues","suffuse","suffuses","useful","usefully","useless","uselessly","uses","yell","yells","yeses","yule"]},{"center":"l","others":["d","i","o","r","s","y"],"words":["dill","dills","dilly","doily","doll","dolls","dolly","drill","drills","drily","droll","drolly","drool","drools","dryly","idly","idol","idols","idyl","idyll","idylls","idyls","ills","lids","lily","loll","lolls","lord","lordly","lords","lorry","loss","oddly","oils","oily","rill","rills","roil","roils","roll","rolls","rosily","sill","sills","silly","silo","silos","slid","slily","slyly","soil","soils","sold","soli","solid","solidly","solids","solo","solos","sols","sordidly"]},{"center":"n","others":["a","b","d","g","o","w"],"words":["abandon","anon","baboon","banana","band","bandana","bandanna","bandwagon","bang","bogon","bonbon","bond","bong","bongo","boon","dawn","down","gang","gnaw","gnawn","gonad","gong","gonna","goon","gown","nabob","noon","wagon","wand","wanna"]},{"center":"r","others":["a","e","f","g","o","v"],"words":["afar","agar","agree","area","aver","average","eager","eagerer","ergo","error","ever","fare","favor","fear","fervor","fever","fora","forage","forager","fore","forego","forever","forgave","forge","forger","forgo","frag","free","freer","frog","garage","gear","gofer","gore","gorge","grave","graver","grog","groove","grove","offer","ogre","over","overage","overeager","raga","rage","rare","rarer","ravage","rave","rear","reef","reefer","reeve","refer","referee","reggae","reorg","revere","roar","roger","roof","roofer","rove","rover","veer","verge","verve"]},{"center":"e","others":["f","i","r","t","u","x"],"words":["eerie","eerier","effete","exert","exit","feet","ferret","fetter","fief","fierier","fife","fire","fitter","fixer","fixture","free","freer","fret","frier","fritter","fruitier","furrier","future","iffier","reef","reefer","refer","referee","refit","refute","retire","retiree","rife","rifer","rite","teeter","terrier","text","texture","tier","tire","titter","tree","trite","triter","true","truer","turret","uteri","utter","xref"]},{"center":"a","others":["l","o","r","t","v","y"],"words":["allay","allot","alloy","ally","altar","alto","aorta","array","arroyo","arty","atoll","attar","atty","avatar","larva","larval","lava","lavatory","loyal","loyally","loyalty","oral","orally","orator","oratory","oval","ovary","rally","ratty","roar","rotary","royal","royally","royalty","tall","tally","taro","tarot","tarry","tart","tartar","tartly","tattoo","tatty","total","totally","tray","valor","vary","votary"]},{"center":"s","others":["a","i","l","n","r","u"],"words":["ails","airs","alas","alias","annals","annuals","annuls","anus","arias","assail","assails","assassin","assassins","assn","auras","ills","illus","inns","insular","insulin","iris","lairs","lass","liars","liras","luaus","lulls","nails","nasal","nasals","nulls","nuns","rails","rains","raisin","raisins","rills","ruins","runs","sail","sails","salsa","salsas","sans","sari","saris","sass","sauna","saunas","sill","sills","sins","sinus","sirs","sisal","slain","slur","slurs","snail","snails","snarl","snarls","suns","ulnas","unsnarl","unsnarls","unusual","urinals","urns","usual"]},{"center":"r","others":["e","f","g","m","n","o"],"words":["emerge","engorge","ergo","error","fern","fore","forego","foregone","foremen","forenoon","forge","forger","forgo","forgone","form","former","free","freemen","freer","frog","frogmen","from","genre","germ","gofer","goner","gore","gorge","green","greener","grog","groom","mere","merge","merger","mermen","monger","moor","more","morn","moron","norm","offer","ogre","reef","reefer","reemerge","refer","referee","reform","reformer","renege","reorg","roger","roof","roofer","room","roomer"]},{"center":"l","others":["a","b","e","m","o","v"],"words":["able","abloom","aloe","amble","babble","babel","bale","ball","balm","bell","belle","bevel","blab","blame","blammo","blob","bloom","bobble","bola","bole","boll","embalm","emblem","evolve","label","lama","lamb","lame","lava","leave","lemma","lemme","levee","level","llama","loam","lobe","loll","loom","lovable","love","loveable","male","mall","malleable","mammal","meal","mole","moll","movable","moveable","oleo","oval","vale","valve","veal","vole"]},{"center":"s","others":["c","e","h","k","p","u"],"words":["checks","checkups","cheeks","cheeps","cheese","cheeses","chess","chucks","cues","cups","cusp","cusps","cuss","cusses","ekes","hues","hush","hushes","husk","husks","keeps","pecks","pecs","peeks","peeps","pees","peps","pucks","pukes","pups","push","pushes","pushup","pushups","puss","pusses","schuss","schusses","secs","seek","seeks","seep","seeps","sees","sheep","shes","shuck","shucks","shuckses","shush","shushes","spec","speck","specks","specs","speech","speeches","success","successes","such","suck","sucks","sues","sups","upchucks","uses"]},{"center":"i","others":["d","g","l","n","t","u"],"words":["dding","diddling","digging","digit","dill","diluting","ding","dinging","dining","dinning","dint","duding","dulling","dunging","dunning","gigging","giggling","gild","gilding","gill","gilt","ginning","gliding","glint","glinting","gluing","glutting","guiding","guild","guilt","gulling","gunning","gutting","idling","igniting","induing","indulging","inning","intuit","intuiting","lilt","lilting","lining","lint","linting","lugging","lulling","lunging","niggling","nudging","nutting","tiding","tiling","till","tilling","tilt","tilting","ting","tinging","tingling","tinning","tint","tinting","titling","tugging","tuning","undid","unit","uniting","until"]},{"center":"i","others":["d","k","l","n","u","y"],"words":["dill","dilly","dink","dinky","idly","idyl","idyll","inky","kiddy","kill","kiln","kind","kindly","kink","kinky","lily","link","ninny","undid","unkind","unkindly"]},{"center":"l","others":["a","e","i","t","v","z"],"words":["alit","alive","alleviate","avail","azalea","elate","elevate","elite","evil","late","latte","lava","laze","leave","levee","level","levitate","lilt","lite","little","live","lvii","tail","tale","tall","tattle","tattletale","teal","teazel","teazle","tell","telltale","tile","till","tilt","titillate","title","tittle","vale","valet","valve","veal","veil","velvet","vial","vile","villa","vital","vitalize","zeal"]},{"center":"m","others":["a","b","c","e","k","o"],"words":["abeam","acme","ameba","amebae","ammo","amoeba","amoebae","amok","bamboo","beam","became","become","bomb","boom","came","cameo","coma","comb","combo","come","comeback","comm","comma","emcee","kaboom","mace","make","mama","mambo","mamma","mecca","meek","meme","memo","mock","momma"]},{"center":"e","others":["c","i","l","s","v","z"],"words":["cell","celli","cells","civies","civilize","civilizes","civvies","eels","ells","else","elves","eves","evil","evils","ices","icicle","icicles","isle","isles","ivies","lees","leis","less","lessee","lessees","levee","levees","level","levels","levies","lice","lies","lilies","lisle","live","lives","secs","sees","seize","seizes","sell","sells","selves","sieve","sieves","sillies","sises","sissies","size","sizes","sizzle","sizzles","sleeve","sleeveless","sleeves","slice","slices","veil","veils","vesicle","vesicles","vessel","vessels","vice","vices","vies","vile","vise","vises"]},{"center":"s","others":["d","g","i","r","t","u"],"words":["digits","digs","disgust","disgusts","diss","distrust","distrusts","druggist","druggists","drugs","druids","duds","dust","dusts","gigs","girds","girts","gist","grids","grist","grits","gurus","gust","gusts","guts","iris","rids","rigs","rugs","rust","rusts","ruts","sirs","sits","situ","stir","stirs","strut","struts","stud","studs","suds","suit","suits","tits","truss","trust","trusts","tugs","turds","tutus"]},{"center":"i","others":["b","e","f","l","n","x"],"words":["beeline","belie","belief","bible","biff","bile","bill","elfin","exile","feline","fief","fife","file","fill","fine","flexible","ibex","infix","inflexible","inline","libel","lief","lien","life","lifeline","line","linen","lxii","lxix","nibble","nine","xiii","xxii","xxiii","xxix","xxxi","xxxii","xxxiii","xxxix"]},{"center":"t","others":["a","c","i","o","r","u"],"words":["acct","actor","actuator","aorta","arctic","atria","attar","attic","attract","auto","autocrat","autocratic","cacti","carat","carrot","cart","cataract","circuit","citric","coat","coot","court","critic","curator","curt","cutout","iota","orator","oratorio","ratio","ricotta","riot","root","rotor","rout","tacit","taco","tact","tactic","taro","tarot","tart","tartar","tattoo","taut","tiara","tiro","toot","tort","tour","tout","tract","tractor","trait","traitor","trio","trot","trout","tutor","tutu"]},{"center":"g","others":["f","i","n","o","r","v"],"words":["fining","firing","fogging","forging","forgiving","forgo","forgoing","fringing","frog","frogging","gigging","ginning","giving","going","gong","gonging","goof","goofing","goon","gorging","goring","griffin","grin","gringo","grinning","grog","groin","grooving","ignoring","infringing","inning","ironing","noggin","offing","ongoing","origin","riffing","rigging","rigor","ring","ringing","roofing","roving","vigor","virgin"]},{"center":"a","others":["e","k","l","m","r","y"],"words":["aery","alarm","allay","alley","ally","ameer","area","army","array","earl","early","earmark","kale","karma","kayak","lake","lama","lame","lamely","lamer","lark","layer","leak","leaky","lemma","llama","make","maker","malarkey","male","mall","mama","mamma","mammal","mammary","mare","mark","marker","marry","meal","mealy","merrymaker","mkay","rake","rally","rare","rarely","rarer","real","realer","really","realm","ream","reamer","rear","rearm","relay","remake","remark","remarry","yammer","year","yearly"]},{"center":"a","others":["c","e","f","l","m","p"],"words":["acme","aflame","alfalfa","alpaca","ample","apace","appal","appall","appeal","apple","calf","call","calm","came","camel","camp","cape","clam","clamp","clap","efface","face","facepalm","faecal","fall","fame","fecal","female","flame","flap","flea","lace","lama","lame","lamp","lapel","leaf","leap","lemma","llama","mace","male","mall","mama","mamma","mammal","maple","meal","mecca","pace","palace","pale","paleface","pall","palm","papa","papal","peace","peal","place","plea"]},{"center":"n","others":["a","c","g","i","o","x"],"words":["acing","again","aging","angina","anion","anon","axing","axon","caging","cancan","caning","canning","cannon","cannoning","canon","coaxing","cocoon","cocooning","cognac","coin","coining","conga","congaing","conic","conning","cooing","coon","gagging","gaging","gain","gaining","gang","ganging","gigging","ginning","going","gong","gonging","gonna","goon","icing","icon","incing","inning","nagging","niacin","nigga","nixing","noggin","noon","ongoing","onion"]},{"center":"n","others":["d","g","i","m","p","u"],"words":["dding","digging","dimming","ding","dinging","dining","dinning","dipping","duding","dumping","dung","dunging","dunning","duping","gigging","ginning","guiding","gumming","gunning","impinging","impugn","impugning","induing","inning","miming","mind","minding","mini","minim","minimum","mining","mugging","mung","munging","nipping","nudging","pidgin","pigging","piing","pimping","ping","pinging","pining","pinning","pinup","piping","pippin","pipping","pudding","pumping","punning","pupping","umping","undid","unpin","unpinning","upping"]},{"center":"o","others":["a","g","h","p","r","t"],"words":["agog","aorta","argot","atop","goat","goop","gorp","gotta","grog","grotto","hoop","hoorah","hoot","horror","oath","orator","parrot","pharaoh","photo","photograph","pooh","poop","poor","poppa","port","potato","prop","rapport","roar","root","rotor","taproot","taro","tarot","tattoo","throat","toga","toot","tooth","torpor","tort","troop","trot","troth"]},{"center":"d","others":["e","f","i","o","t","u"],"words":["dded","deed","deeded","defied","deft","deified","died","diet","dieted","diff","diffed","diode","ditto","dittoed","dodo","doff","doffed","dote","doted","dotted","dude","duded","duet","duff","eddied","edified","edit","edited","feed","feted","fetid","feud","feuded","fitted","food","footed","idiot","offed","outdid","outdo","outed","outfitted","teed","tide","tided","tidied","tied","tiffed","toed","tooted","toted","totted","touted","tufted"]},{"center":"e","others":["c","l","r","t","u","y"],"words":["celery","cell","clue","clutter","creel","cruel","crueler","crueller","cruelly","cruelty","cruet","cruller","culture","cure","curer","curler","curlycue","curter","cute","cutely","cuter","cutlery","cutlet","cutter","cycle","ecru","eery","elect","erect","erectly","eyelet","lecture","lecturer","leer","leery","letter","lettuce","lucre","lure","lute","lyre","recur","recycle","reel","reelect","rely","retell","retry","rule","ruler","teeter","tell","teller","terry","tree","truce","true","truer","tulle","turret","turtle","ulcer","utter","utterly","yell","yule"]},{"center":"r","others":["a","c","e","i","n","u"],"words":["accrue","acre","aerie","airier","arcane","area","arena","aria","aura","aurae","cairn","cancer","cannier","care","careen","career","carrier","circa","crane","crania","crier","cure","curer","curie","earn","earner","ecru","eerie","eerier","enure","icier","inaner","incur","inner","inure","nacre","narc","near","nearer","nicer","race","racer","racier","rain","rainier","rare","rarer","rear","recur","recurrence","rein","reran","rerun","rice","ruin","rune","runic","runner","runnier","uncannier","urea","uric","urine"]},{"center":"e","others":["a","c","h","k","p","y"],"words":["ache","apace","cache","cake","cape","cheap","check","cheek","cheeky","cheep","each","hake","heap","heck","hype","keep","pace","paycheck","payee","peace","peach","peak","peck","peek","peep","peppy","yeah"]},{"center":"a","others":["c","i","m","n","r","u"],"words":["acacia","airman","amir","aria","aura","cairn","cancan","circa","cram","crania","cranium","imam","maim","main","mama","mamma","mania","maniac","manic","manna","maraca","maria","marina","mica","micra","minicam","minima","narc","niacin","rain","unman","uranium"]},{"center":"l","others":["a","e","f","t","u","y"],"words":["alfalfa","allay","alley","ally","elate","eyeful","eyelet","fall","fatal","fatally","fateful","fatefully","fault","faulty","fealty","feel","fell","felt","fetal","fettle","flat","flatfeet","flatly","flay","flea","flee","fleet","flue","fluff","fluffy","flute","flyleaf","fuel","full","fully","late","lately","latte","layette","leaf","leaflet","leafy","left","lefty","luau","lull","lute","tale","tall","tally","tattle","tattletale","tautly","teal","tell","telltale","tulle","ululate","yell","yule"]},{"center":"s","others":["i","m","o","p","u","y"],"words":["impious","imps","isms","miss","moms","moos","mops","moss","mossy","mousy","mumps","muss","mussy","muumuus","oops","opossum","opossums","opus","osmosis","pimps","pious","pips","piss","pompoms","pompous","poops","pops","poss","possum","possums","posy","pumps","pups","puss","pussy","sims","sips","sissy","soppy","sops","soup","soups","soupy","sumo","sump","sumps","sums","sups","symposium","symposiums","sysop","sysops","umps","yips","yous","yups"]},{"center":"r","others":["e","g","m","o","t","y"],"words":["eery","egret","emerge","emery","ergo","error","geometer","geometry","germ","gore","gorge","gory","greet","grey","greyer","grog","groggy","grommet","groom","grotto","gyro","memory","mere","merge","merger","merry","meteor","meter","metro","moor","more","motor","ogre","orgy","otter","reemerge","regret","remote","remoter","reorg","retort","retry","roger","room","roomer","roomy","root","rooter","rote","rotor","teeter","term","terror","terry","tore","tort","torte","totter","tree","tremor","trot","trotter","troy","tyro","yore"]},{"center":"e","others":["b","c","p","r","t","u"],"words":["beep","beeper","beer","beet","beret","better","brute","butte","butter","buttercup","creep","creeper","crepe","crept","cruet","cube","cure","curer","curter","cute","cuter","cutter","ecru","erect","erupt","peep","peeper","peer","pepper","pert","perter","perturb","peter","precept","prep","puppet","puppeteer","pure","puree","purer","putter","rebut","recur","repute","rubber","rube","rupee","rupture","teepee","teeter","tepee","tree","truce","true","truer","tube","tuber","turret","upper","uppercut","utter"]},{"center":"e","others":["b","c","f","l","t","u"],"words":["beef","beet","beetle","befell","bell","belle","belt","blue","bluebell","bubble","buffet","bullet","butte","cell","clef","cleft","clubfeet","clue","cube","cute","cutlet","effect","effete","elect","feeble","feel","feet","fell","felt","fettle","flee","fleece","fleet","flue","flute","fuel","left","lettuce","lube","lute","tell","tube","tulle"]},{"center":"s","others":["b","c","e","i","o","x"],"words":["bees","bibs","bobbies","bobs","boobies","boobs","boos","boss","bosses","boxes","cobs","coccis","coos","cosies","ebbs","excess","excesses","excise","excises","execs","exes","ibexes","ibices","ibis","ibises","iceboxes","ices","obese","oboes","obsess","obsesses","secs","sees","sexes","sics","sises","sissies","sixes","sobs"]},{"center":"i","others":["g","h","m","n","p","u"],"words":["gigging","ginning","gumming","gunning","high","hing","hinging","hipping","hugging","humming","humping","impinging","impugn","impugning","inning","miming","mini","minim","minimum","mining","mugging","munging","nigh","nipping","pigging","piing","pimp","pimping","ping","pinging","pining","pinning","pinup","piping","pippin","pipping","pumping","punning","pupping","umping","unhinging","unpin","unpinning","upping"]},{"center":"e","others":["h","l","n","o","p","t"],"words":["elope","entente","heel","hell","hellhole","hello","helot","help","hole","hone","hope","hotel","lent","lept","lone","loophole","lope","neon","nettle","noel","none","nope","note","oleo","open","opponent","peel","peep","peephole","pellet","pelt","pennon","pent","peon","people","phone","poet","pole","pollen","pone","pope","potent","pothole","teen","teepee","teeth","teethe","telephone","telephoto","telethon","tell","telnet","tenet","tenon","tent","tenth","tepee","thee","then","tone","tonne","topple","tote"]},{"center":"l","others":["c","e","i","o","t","v"],"words":["cell","celli","cello","civil","clii","clit","clot","clove","clvi","clvii","coil","colic","collect","collective","collie","colt","cool","coolie","eclectic","elect","elective","elicit","elite","evil","evolve","icicle","illicit","ioctl","levee","level","lice","licit","lilt","lite","little","live","loci","loco","loll","loot","lotto","love","lvii","ocelot","oleo","olive","tell","tile","till","tilt","title","tittle","toil","toilet","toilette","toll","tool","veil","velvet","vile","viol","violet","voile","vole","volt"]},{"center":"o","others":["b","g","i","l","m","r"],"words":["bimbo","blob","blog","bloom","boil","boll","bomb","boob","boom","boor","broil","broom","gigolo","glob","gloom","grog","groom","igloo","imbroglio","limbo","limo","logo","loll","loom","mirror","moll","moor","rigor","roil","roll","room"]},{"center":"a","others":["b","c","i","k","l","m"],"words":["abaci","aback","acacia","acclaim","alibi","alkali","bacilli","back","bail","balalaika","balk","ball","balm","biblical","blab","black","blackball","blackmail","cabal","calk","call","calm","cambia","cilia","clack","claim","clam","iamb","iambic","imam","kickback","labia","labial","lack","lama","lamb","lilac","llama","mail","maim","mall","mama","mamma","mammal","mica"]},{"center":"l","others":["a","i","k","o","t","w"],"words":["alit","alkali","allot","allow","alto","atoll","awol","kill","kilo","kilowatt","kilt","koala","lilt","loll","look","loot","lotto","tail","talk","tall","tallow","till","tilt","toil","toll","tool","toolkit","total","twill","wail","walk","wall","wallow","will","willow","wilt","wool"]},{"center":"a","others":["c","l","r","t","u","y"],"words":["accrual","acct","accuracy","actual","actually","actuary","allay","ally","altar","array","arty","attar","attract","atty","aura","aural","aurally","call","caracul","carat","carry","carryall","cart","cataract","catcall","catty","clay","cray","cultural","culturally","curacy","lacy","luau","racy","rally","ratty","rural","tact","talc","tall","tally","tarry","tart","tartar","tartly","tatty","taut","tautly","tract","tray","ultra","yucca"]},{"center":"e","others":["c","f","i","k","n","r"],"words":["creek","crier","eerie","eerier","fence","fencer","fern","ferric","fief","fierce","fiercer","fierier","fife","fine","finer","finickier","fire","free","freer","frier","icier","ickier","iffier","infer","inference","inkier","inner","keen","keener","kicker","kickier","kinkier","knee","knife","neck","nice","nicer","niece","nine","reef","reefer","reek","refer","referee","reference","refine","refiner","rein","rice","rife","rifer"]},{"center":"e","others":["a","c","d","m","u","v"],"words":["accede","acceded","aced","acme","added","adduce","adduced","came","cave","caved","cede","ceded","cued","dame","dammed","dded","dead","decade","deduce","deduced","deed","deeded","deem","deemed","deuce","dude","duded","eave","edamame","edema","emcee","emceed","evacuee","evade","evaded","mace","maced","madame","made","mauve","mead","mecca","meme","vacuumed"]},{"center":"s","others":["h","i","n","o","p","y"],"words":["hippos","hips","hiss","hoops","hops","hypnosis","hypos","inns","ions","nips","noisy","nosh","nosy","onions","oops","opinions","phish","pinions","pins","pippins","pips","piss","poison","poisons","poohs","poops","pops","posh","poss","posy","shin","shinny","shins","shiny","ship","ships","shoo","shoon","shoos","shop","shops","sins","siphon","siphons","sips","sissy","snip","snippy","snips","snoop","snoops","snoopy","sonny","sons","soon","soppy","sops","spin","spins","spiny","spoon","spoons","synopsis","syphon","syphons","sysop","sysops","yips"]},{"center":"l","others":["a","b","e","i","o","v"],"words":["able","alibi","alive","aloe","avail","available","babble","babel","bail","bale","ball","belie","believable","believe","bell","belle","bevel","bible","bile","bill","bivalve","blab","blob","bobble","boil","bola","bole","boll","evil","evolve","label","labia","labial","lava","leave","levee","level","liable","libel","livable","live","liveable","lobe","loll","lovable","love","loveable","lvii","oleo","olive","oval","vale","valve","veal","veil","viable","vial","vile","villa","viol","viola","violable","voile","vole"]},{"center":"n","others":["g","i","k","l","p","u"],"words":["gigging","giggling","ginning","gluing","gulling","gulping","gunk","gunning","inking","inkling","inning","killing","kiln","kilning","king","kingpin","kink","kinking","liking","lining","link","linking","linkup","lugging","lulling","lung","lunging","lupin","niggling","nipping","nuking","null","pigging","piing","piking","piling","pilling","ping","pinging","pining","pink","pinking","pinning","pinup","piping","pippin","pipping","plugging","plugin","plunging","plunk","plunking","puking","pulling","pulping","punk","punning","pupping","unpin","unpinning","unplug","unplugging","upping"]},{"center":"s","others":["a","d","g","h","n","u"],"words":["adds","anus","assn","dads","dash","duds","dungs","duns","gads","gags","gangs","gash","gnash","gnus","guns","gush","hags","handguns","hands","hangs","hash","hugs","hush","nags","nuns","saga","sagas","sags","sand","sands","sang","sans","sash","sass","sauna","saunas","shad","shads","shag","shags","shah","shahs","shun","shuns","shush","snag","snags","snug","snugs","suds","sung","suns","unhands","unsung"]},{"center":"s","others":["c","e","h","l","q","u"],"words":["cells","cheese","cheeses","chess","clueless","clues","cues","culls","cuss","cusses","eels","ells","else","heels","hues","hulls","hush","hushes","leeches","lees","less","lessee","lessees","lulls","lush","lushes","quells","ques","queues","schuss","schusses","scull","sculls","secs","sees","sell","sells","sequel","sequels","shell","shells","shes","shush","shushes","slue","slues","slush","squelch","squelches","success","successes","such","sues","useless","uses"]},{"center":"o","others":["d","f","n","r","u","y"],"words":["dodo","doff","donor","door","dory","dour","dunno","fond","fondu","food","ford","found","foundry","four","frond","furor","noddy","noon","noun","odor","rood","roof","round","runoff","undo","your"]},{"center":"o","others":["a","d","l","n","r","u"],"words":["adorn","aloud","anon","ardor","around","dado","dodo","doll","dollar","donor","doodad","door","dour","droll","drool","dunno","landlord","llano","load","loan","loll","loon","lord","lorn","loud","nodal","nodular","noon","noun","odor","oral","radon","road","roan","roar","roll","rood","round","runaround","undo","unload","unroll"]}]
;

  var bee = { puzzle:null, center:"", letters:[], words:[], maxScore:0, current:"", score:0, found:[], outerOrder:[0,1,2,3,4,5] };
  var beeMsgTimeout = null;

  var BEE_RANKS = [
    { pct:0,    label:"Freshman" },
    { pct:0.10, label:"Student" },
    { pct:0.25, label:"Bright" },
    { pct:0.40, label:"Sharp" },
    { pct:0.60, label:"Smart" },
    { pct:0.80, label:"Genius" }
  ];

  function beeScoreWord(word, letters){
    var base = word.length === 4 ? 1 : word.length;
    if (word.length >= 7){
      var uniq = {};
      for (var i=0;i<word.length;i++) uniq[word[i]] = true;
      if (Object.keys(uniq).length === letters.length) base += 7; // pangram bonus
    }
    return base;
  }

  function openSpellingBee(){
    var today = todayStr();
    var idx = hashString("bee-" + today) % BEE_PUZZLES.length;
    var p = BEE_PUZZLES[idx];
    bee.puzzle = p;
    bee.center = p.center;
    bee.letters = [p.center].concat(p.others);
    bee.words = p.words;
    bee.outerOrder = [0,1,2,3,4,5];
    bee.current = "";
    bee.maxScore = 0;
    p.words.forEach(function(w){ bee.maxScore += beeScoreWord(w, bee.letters); });

    var existing = (store.dailyLog.spellingbee || {})[today];
    if (existing){
      bee.score = existing.score;
      bee.found = existing.wordsFound.slice();
    } else {
      bee.score = 0;
      bee.found = [];
    }

    renderBeeHex();
    updateBeeWordDisplay();
    updateBeeScoreDisplay();
    renderBeeFoundList();
    showBeeMessage("", false);
  }

  function renderBeeHex(){
    var wrap = document.getElementById("beeHexWrap");
    wrap.innerHTML = "";
    var centerCell = document.createElement("div");
    centerCell.className = "bee-cell center";
    centerCell.textContent = bee.center.toUpperCase();
    centerCell.style.left = "50%"; centerCell.style.top = "50%"; centerCell.style.transform = "translate(-50%,-50%)";
    centerCell.addEventListener("click", function(){ appendBeeLetter(bee.center); });
    wrap.appendChild(centerCell);

    var others = bee.puzzle.others;
    for (var i=0;i<6;i++){
      var letterIdx = bee.outerOrder[i];
      var letter = others[letterIdx];
      var angle = (-90 + i*60) * Math.PI/180;
      var x = 50 + 34*Math.sin(angle);
      var y = 50 - 34*Math.cos(angle);
      var cell = document.createElement("div");
      cell.className = "bee-cell outer";
      cell.textContent = letter.toUpperCase();
      cell.style.left = x+"%"; cell.style.top = y+"%"; cell.style.transform = "translate(-50%,-50%)";
      (function(l){ cell.addEventListener("click", function(){ appendBeeLetter(l); }); })(letter);
      wrap.appendChild(cell);
    }
  }

  function appendBeeLetter(letter){
    bee.current += letter;
    updateBeeWordDisplay();
  }
  function deleteBeeLetter(){
    bee.current = bee.current.slice(0, -1);
    updateBeeWordDisplay();
  }
  function updateBeeWordDisplay(){
    document.getElementById("beeWordDisplay").textContent = bee.current || "\u00A0";
  }

  function showBeeMessage(text, isGood){
    var el = document.getElementById("beeMessage");
    el.textContent = text;
    el.style.color = isGood ? "var(--good)" : "var(--ink-soft)";
    if (beeMsgTimeout) clearTimeout(beeMsgTimeout);
    if (text) beeMsgTimeout = setTimeout(function(){ el.textContent = ""; }, 1800);
  }

  function submitBeeWord(){
    var word = bee.current.toLowerCase();
    bee.current = "";
    updateBeeWordDisplay();
    if (!word) return;
    if (word.length < 4){ showBeeMessage("Too short", false); return; }
    if (word.indexOf(bee.center) === -1){ showBeeMessage("Missing center letter", false); return; }
    if (bee.found.indexOf(word) !== -1){ showBeeMessage("Already found", false); return; }
    if (bee.words.indexOf(word) === -1){ showBeeMessage("Not in word list", false); return; }

    var pts = beeScoreWord(word, bee.letters);
    var isPangram = pts >= word.length + 7;
    bee.found.push(word);
    bee.score += pts;

    var today = todayStr();
    if (!store.dailyLog.spellingbee) store.dailyLog.spellingbee = {};
    store.dailyLog.spellingbee[today] = { score: bee.score, wordsFound: bee.found.slice(), maxPossible: bee.maxScore };
    if (!store.highScores.spellingbee || bee.score > store.highScores.spellingbee){
      store.highScores.spellingbee = bee.score;
    }
    saveStore();

    showBeeMessage(isPangram ? ("Pangram! +" + pts) : ("+" + pts), true);
    updateBeeScoreDisplay();
    renderBeeFoundList();
  }

  function updateBeeScoreDisplay(){
    document.getElementById("beeScore").textContent = bee.score;
    var pct = bee.maxScore > 0 ? bee.score / bee.maxScore : 0;
    var rank = BEE_RANKS[0].label;
    BEE_RANKS.forEach(function(r){ if (pct >= r.pct) rank = r.label; });
    document.getElementById("beeRank").textContent = rank;

    var fillPct = Math.max(0, Math.min(100, pct * 100));
    document.getElementById("beeTierFill").style.width = fillPct + "%";

    var ticksEl = document.getElementById("beeTierTicks");
    ticksEl.innerHTML = "";
    BEE_RANKS.forEach(function(r){
      var tick = document.createElement("div");
      tick.className = "bee-tier-tick" + (pct >= r.pct ? " reached" : "");
      tick.style.left = (r.pct * 100) + "%";
      tick.textContent = r.label;
      ticksEl.appendChild(tick);
    });
  }

  function renderBeeFoundList(){
    var list = document.getElementById("beeFoundList");
    list.innerHTML = "";
    document.getElementById("beeFoundCount").textContent = bee.found.length + " word" + (bee.found.length===1?"":"s") + " found";
    var sorted = bee.found.slice().sort();
    sorted.forEach(function(w){
      var isPangram = new Set ? (new Set(w.split(""))).size === bee.letters.length : false;
      var chip = document.createElement("div");
      chip.className = "bee-found-word" + (isPangram ? " pangram" : "");
      chip.textContent = w;
      list.appendChild(chip);
    });
  }

  function shuffleBeeLetters(){
    for (var i = bee.outerOrder.length - 1; i > 0; i--){
      var j = Math.floor(Math.random() * (i+1));
      var tmp = bee.outerOrder[i]; bee.outerOrder[i] = bee.outerOrder[j]; bee.outerOrder[j] = tmp;
    }
    renderBeeHex();
  }

  document.getElementById("beeBackBtn").addEventListener("click", function(){ showPage("favoritesPage"); });
  document.getElementById("beeDeleteBtn").addEventListener("click", deleteBeeLetter);
  document.getElementById("beeEnterBtn").addEventListener("click", submitBeeWord);
  document.getElementById("beeShuffleBtn").addEventListener("click", shuffleBeeLetters);
  document.addEventListener("keydown", function(e){
    if (!document.getElementById("spellingbeePage").classList.contains("active")) return;
    if (e.key === "Enter"){ submitBeeWord(); return; }
    if (e.key === "Backspace"){ deleteBeeLetter(); return; }
    var k = e.key.toLowerCase();
    if (bee.letters.indexOf(k) !== -1) appendBeeLetter(k);
  });


  // ================= DAILY FIVE (word-guess) ENGINE =================
  var DF_ANSWERS = ["alley","aloha","amino","apace","baked","bases","bates","bayou","beefs","biddy","blows","boons","braid","carpi","cocky","copes","crony","deeps","diary","disco","dolly","domes","dries","dross","drugs","duped","ebony","floes","foals","focus","frank","frock","furry","gages","genii","gills","gland","gofer","gores","greed","henna","hired","hobos","laced","laden","might","minty","misdo","morns","mosey","muses","musts","noses","notch","plunk","raved","rimed","rumor","sacks","sahib","salon","saved","shame","signs","slows","spies","taint","tarot","taste","tatty","temps","toots","trots","tusks","typed","verse","walks","weals","woken","\u00e9clat"];
  var DF_GUESSES_SET = {};
  (["abaci","aback","abaft","abase","abash","abate","abbey","abbot","abb\u00e9s","abeam","abets","abhor","abide","abler","abode","abort","about","above","abuse","abuts","abuzz","abyss","ached","aches","achoo","acids","acing","acmes","acorn","acres","acrid","acted","actor","acute","adage","adapt","added","adder","addle","adept","adieu","adi\u00f3s","adman","admen","admin","admit","adobe","adopt","adore","adorn","adult","adzes","aegis","aeons","aerie","affix","afire","afoot","afoul","after","again","agape","agate","agave","agent","agile","aging","agism","aglow","agony","agree","ahead","aided","aides","ailed","aimed","aired","aisle","alarm","album","alder","alert","algae","alias","alibi","alien","align","alike","aline","alive","allay","alley","allot","allow","alloy","aloes","aloft","aloha","alone","along","aloof","aloud","alpha","altar","alter","altho","altos","alums","amass","amaze","amber","amble","ameba","ameer","amend","amigo","amino","amirs","amiss","amity","among","amour","ample","amply","ampul","amuck","amuse","angel","anger","angle","angry","angst","anime","anion","anise","ankhs","ankle","annex","annoy","annul","anode","anons","anted","antes","antic","antis","anvil","aorta","apace","apart","aphid","aping","appal","apple","apply","apron","apses","apter","aptly","aquae","aquas","arbor","arced","ardor","areas","arena","argon","argot","argue","arias","arise","armed","armor","aroma","arose","array","arrow","arson","artsy","ascot","ashed","ashen","ashes","aside","asked","askew","aspen","aspic","assay","asses","asset","assoc","aster","astir","atlas","atoll","atoms","atone","atria","attar","attic","audio","audit","auger","aught","augur","aunts","aurae","aural","auras","autos","avail","avast","avers","avert","avian","avoid","avows","await","awake","award","aware","awash","awful","awing","awoke","axial","axing","axiom","axles","axons","azure","baaed","babel","babes","backs","bacon","badge","badly","bagel","baggy","bails","baits","baize","baked","baker","bakes","balds","baled","bales","balks","balky","balls","balms","balmy","balsa","banal","bands","bandy","banes","bangs","banjo","banks","banns","barbs","bards","bared","barer","bares","barfs","barge","barks","barns","baron","basal","based","baser","bases","basic","basil","basin","basis","basks","bassi","basso","baste","batch","bated","bates","bathe","baths","batik","baton","batty","bauds","bawdy","bawls","bayed","bayou","beach","beads","beady","beaks","beams","beans","beard","bears","beast","beats","beaus","beaux","bebop","becks","beech","beefs","beefy","beeps","beers","beets","befit","befog","began","begat","beget","begin","begot","begun","beige","being","belay","belch","belie","belle","bells","belly","below","belts","bench","bends","bents","beret","bergs","berms","berry","berth","beryl","beset","besom","besot","bests","betas","bevel","bible","bicep","biddy","bided","bides","bidet","biers","biffs","bight","bigot","biked","biker","bikes","bilge","bilks","bills","billy","bimbo","binds","binge","bingo","biped","birch","birds","birth","bison","bitch","bites","blabs","black","blade","blame","bland","blank","blare","blast","blas\u00e9","blats","blaze","bleak","bleat","bleed","bleep","blend","blent","bless","blest","blimp","blind","bling","blink","blips","bliss","blitz","bloat","blobs","block","blocs","blogs","blond","blood","bloom","blots","blown","blows","blued","bluer","blues","bluff","blunt","blurb","blurs","blurt","blush","board","boars","boast","boats","bobby","boded","bodes","bogey","boggy","bogie","bogon","bogus","boils","boink","bolas","boles","bolls","bolts","bombs","bonds","boned","boner","bones","boney","bongo","bongs","bonny","bonus","boobs","booby","booed","books","booms","boons","boors","boost","booth","boots","booty","booze","boozy","borax","bored","borer","bores","borne","boron","bosom","bossy","bosun","botch","bough","bound","bouts","bowed","bowel","bower","bowls","boxed","boxen","boxer","boxes","bozos","brace","bract","brads","brags","braid","brain","brake","brand","brash","brass","brats","brave","bravo","brawl","brawn","brays","bread","break","breed","brews","briar","bribe","brick","bride","brief","brier","brigs","brims","brine","bring","brink","briny","brisk","broad","broil","broke","brood","brook","broom","broth","brown","brows","bruin","brunt","brush","brusk","brute","bucks","buddy","budge","buffs","buggy","bugle","build","built","bulbs","bulge","bulgy","bulks","bulky","bulls","bully","bumps","bumpy","bunch","bungs","bunks","bunny","bunts","buoys","burgs","burka","burly","burns","burnt","burps","burro","burrs","burst","busby","bused","buses","bushy","busts","butch","butte","butts","buxom","buyer","bylaw","bytes","byway","cabal","cabby","cabin","cable","cacao","cache","cacti","caddy","cadet","cadge","cadre","caf\u00e9s","caged","cages","cagey","cairn","caked","cakes","calfs","calif","calks","calls","calms","calve","calyx","camel","cameo","camps","campy","canal","candy","caned","canes","canny","canoe","canon","canto","cants","caped","caper","capes","capon","carat","carbs","cards","cared","cares","caret","cargo","carol","carom","carpi","carps","carry","carts","carve","cased","cases","casks","caste","casts","catch","cater","catty","caulk","cause","caved","caves","cavil","cawed","cease","cedar","ceded","cedes","celli","cello","cells","cents","chads","chafe","chaff","chain","chair","chalk","champ","chant","chaos","chaps","chapt","charm","chars","chart","chary","chase","chasm","chats","cheap","cheat","check","cheek","cheep","cheer","chefs","chess","chest","chews","chewy","chick","chide","chief","child","chile","chili","chill","chime","chimp","china","chink","chino","chins","chips","chirp","chits","chive","chock","choir","choke","chomp","chops","chord","chore","chose","chows","chuck","chugs","chump","chums","chunk","churl","churn","chute","cider","cigar","cilia","cinch","circa","cited","cites","civet","civic","civil","clack","claim","clamp","clams","clang","clank","clans","claps","clash","clasp","class","claws","clean","clear","cleat","clefs","cleft","clerk","clews","click","cliff","climb","clime","cling","clink","clips","clipt","clits","cloak","clock","clods","clogs","clomp","clone","clops","close","cloth","clots","cloud","clout","clove","clown","cloys","clubs","cluck","clued","clues","clump","clung","clunk","clvii","clxii","clxiv","clxix","clxvi","coach","coals","coast","coats","cobra","cocci","cocks","cocky","cocoa","codas","coded","codes","codex","coeds","coifs","coils","coins","coked","cokes","colas","colds","colic","colon","color","colts","comas","combo","combs","comer","comes","comet","comfy","comic","comma","compo","conch","condo","cones","conga","conic","conks","contd","cooed","cooks","cooky","cools","coons","coops","coots","coped","copes","copra","copse","coral","cords","cored","cores","corks","corms","corns","corny","corps","costs","cotes","couch","cough","could","count","coupe","coups","court","coven","cover","coves","covet","covey","cowed","cower","cowls","coyer","coyly","cozen","crabs","crack","craft","crags","cramp","crams","crane","crank","crape","craps","crash","crass","crate","crave","crawl","craws","crays","craze","crazy","creak","cream","credo","creed","creek","creel","creep","crepe","crept","cress","crest","crews","cribs","crick","cried","crier","cries","crime","crimp","crisp","croak","croci","crock","crone","crony","crook","croon","crops","cross","croup","crowd","crown","crows","crude","cruel","cruet","cruft","crumb","crush","crust","crypt","cubed","cubes","cubic","cubit","cuffs","cuing","culls","cults","cumin","cunts","cupid","curbs","curds","cured","curer","cures","curie","curio","curls","curly","curry","curse","curst","curve","curvy","cushy","cusps","cuter","cutup","cycle","cynic","cysts","czars","dacha","daddy","dados","daffy","daily","dairy","daisy","dales","dally","dames","damns","damps","dance","dandy","dared","dares","darns","darts","dated","dates","datum","daubs","daunt","davit","dawns","dazed","dazes","dding","deals","dealt","deans","dears","death","debar","debit","debts","debug","debut","decaf","decal","decay","decks","decor","decoy","decry","deeds","deems","deeps","deers","defer","deice","deify","deign","deism","deity","delay","delis","dells","delta","delve","demon","demos","demur","denim","dense","dents","depot","depth","derby","desks","deter","detox","deuce","devil","dhoti","dials","diary","diced","dices","dicey","dicks","dicky","dicta","diets","diffs","digit","diked","dikes","dills","dilly","dimer","dimes","dimly","dined","diner","dines","dingo","dings","dingy","dinky","diode","direr","dirge","dirks","dirty","disco","discs","disks","ditch","ditto","ditty","divan","divas","dived","diver","dives","divot","divvy","dizzy","djinn","docks","dodge","dodgy","dodos","doers","doffs","doggy","dogie","dogma","doily","doing","doled","doles","dolls","dolly","dolts","domed","domes","donor","donut","dooms","doors","doped","dopes","dopey","dorks","dorky","dorms","dosed","doses","doted","dotes","dotty","doubt","dough","douse","doves","dowdy","dowel","downs","downy","dowry","dowse","doyen","dozed","dozen","dozes","drabs","draft","drags","drain","drake","drama","drams","drank","drape","drawl","drawn","draws","drays","dread","dream","dregs","dress","dried","drier","dries","drift","drill","drily","drink","drips","drive","droid","droll","drone","drool","droop","drops","dross","drove","drown","drubs","drugs","druid","drums","drunk","dryad","dryer","dryly","ducal","ducat","duchy","ducks","ducts","duded","dudes","duels","duets","dukes","dulls","dully","dummy","dumps","dumpy","dunce","dunes","dungs","dunks","dunno","duped","dupes","dusky","dusts","dusty","duvet","dwarf","dweeb","dwell","dwelt","dyers","dying","dyked","dykes","eager","eagle","earls","early","earns","earth","eased","easel","eases","eaten","eater","eaves","ebbed","ebony","echos","edema","edged","edger","edges","edict","edify","edits","eerie","egged","egret","eider","eight","eject","eking","elate","elbow","elder","elect","elegy","elfin","elide","elite","elope","elude","elves","email","embed","ember","emcee","emend","emery","emirs","emits","emoji","emote","empty","enact","ended","endow","endue","enema","enemy","enjoy","ennui","enrol","ensue","enter","entry","enure","envoy","epics","epoch","epoxy","equal","equip","erase","erect","erode","erred","error","erupt","essay","ester","ether","ethic","ethos","euros","evade","evens","event","every","evict","evils","evoke","ewers","exact","exalt","exams","excel","execs","exert","exile","exist","exits","expel","expos","extol","extra","exude","exult","eying","fable","faced","faces","facet","facts","faded","fades","fagot","fails","faint","fairs","fairy","faith","faked","faker","fakes","fakir","falls","false","famed","fancy","fangs","fanny","farce","fared","fares","farms","farts","fasts","fatal","fated","fates","fatty","fault","fauna","fauns","favor","fawns","faxed","faxes","fazed","fazes","fears","feast","feats","fecal","feces","feeds","feels","feign","feint","fells","felon","felts","femur","fence","fends","feral","ferns","ferry","fests","fetal","fetch","feted","fetid","fetus","feuds","fever","fewer","fezes","fiats","fiber","fiche","fiefs","field","fiend","fiery","fifes","fifth","fifty","fight","filch","filed","files","filet","fills","filly","films","filmy","filth","final","finch","finds","fined","finer","fines","finis","finks","finny","fiord","fired","fires","firms","first","firth","fishy","fists","fitly","fiver","fives","fixed","fixer","fixes","fizzy","fjord","flack","flags","flail","flair","flake","flaky","flame","flank","flaps","flare","flash","flask","flats","flaws","flays","fleas","fleck","flees","fleet","flesh","flick","flied","flier","flies","fling","flint","flips","flirt","flits","float","flock","floes","flogs","flood","floor","flops","flora","floss","flour","flout","flown","flows","flubs","flues","fluff","fluid","fluke","fluky","flume","flung","flunk","flush","flute","flyby","flyer","foals","foams","foamy","focal","focus","fogey","foggy","foils","foist","folds","folio","folks","folly","fondu","fonts","foods","fools","foots","foray","force","fords","fores","forge","forgo","forks","forms","forte","forth","forts","forty","forum","fouls","found","fount","fours","fowls","foxed","foxes","foyer","frack","frags","frail","frame","franc","frank","frats","fraud","frays","freak","freed","freer","frees","fresh","frets","friar","fried","frier","fries","frill","frisk","frizz","frock","frogs","frond","front","frost","froth","frown","froze","fruit","frump","fryer","fucks","fudge","fuels","fugue","fulls","fully","fumed","fumes","funds","fungi","funks","funky","funny","furls","furor","furry","furze","fused","fuses","fussy","fusty","futon","fuzed","fuzes","fuzzy","f\u00eates","gabby","gable","gaffe","gaffs","gaged","gages","gaily","gains","gaits","galas","gales","galls","gamed","gamer","games","gamey","gamin","gamma","gamut","gangs","gaped","gapes","garbs","gases","gasps","gassy","gated","gates","gaudy","gauge","gaunt","gauze","gauzy","gavel","gawks","gawky","gayer","gayly","gazed","gazer","gazes","gears","gecko","geeks","geeky","geese","gelds","gelid","genes","genie","genii","genre","gents","genus","geode","germs","getup","ghost","ghoul","giant","gibed","gibes","giddy","gifts","gilds","gills","gilts","gimme","gimpy","gipsy","girds","girls","girth","girts","gismo","given","gives","gizmo","glade","glads","gland","glare","glass","glaze","gleam","glean","glens","glide","glint","glitz","gloat","globe","globs","gloom","glory","gloss","glove","glows","glued","glues","gluey","gluts","glyph","gnarl","gnash","gnats","gnawn","gnaws","gnome","goads","goals","goats","godly","gofer","going","golds","golfs","golly","gonad","goner","gongs","gonks","gonna","gonzo","goods","goody","gooey","goofs","goofy","gooks","goons","goose","gored","gores","gorge","gorps","gorse","gotta","gouge","gourd","gouty","gowns","grabs","grace","grade","grads","graft","grail","grain","grams","grand","grant","grape","graph","grasp","grass","grate","grave","gravy","grays","graze","great","grebe","greed","green","greet","greps","greys","grids","grief","grill","grime","grimy","grind","grins","gripe","grips","grist","grits","groan","groin","groks","groom","grope","gross","group","grout","grove","growl","grown","grows","grubs","gruel","grues","gruff","grunt","guano","guard","guava","guess","guest","guide","guild","guile","guilt","guise","gulag","gulch","gulfs","gulls","gully","gulps","gumbo","gummy","gunny","guppy","gurus","gushy","gusto","gusts","gusty","gutsy","guyed","gybed","gybes","gypsy","gyros","habit","hacks","hafts","haiku","hails","hairs","hairy","hakes","haled","haler","hales","halls","halon","halos","halts","halve","hands","handy","hangs","hanks","hanky","happy","hardy","hared","harem","hares","harks","harms","harps","harpy","harry","harsh","harts","hasps","haste","hasty","hatch","hated","hater","hates","hauls","haunt","haven","haves","havoc","hawed","hawks","hayed","hazed","hazel","hazes","heads","heady","heals","heaps","heard","hears","heart","heath","heats","heave","heavy","hedge","heeds","heels","hefts","hefty","heirs","heist","helix","hello","helms","helot","helps","hence","henna","herbs","herds","heron","heros","hertz","hewed","hewer","hexed","hexes","hicks","hided","hides","highs","hiked","hiker","hikes","hills","hilly","hilts","hinds","hinge","hings","hints","hippo","hippy","hired","hires","hitch","hived","hives","hoagy","hoard","hoary","hobby","hobos","hocks","hogan","hoist","hokey","hokum","holds","holed","holes","holly","homed","homer","homes","homey","homie","honed","hones","honey","honks","honor","hooch","hoods","hooey","hoofs","hooks","hooky","hoops","hoots","hoped","hopes","horde","horns","horny","horse","horsy","hosed","hoses","hosts","hotel","hotly","hound","hours","house","hovel","hover","howdy","howls","hubby","huffs","huffy","huger","hulas","hulks","hulls","human","humid","humor","humps","humus","hunch","hunks","hunts","hurls","hurry","hurts","husks","husky","hussy","hutch","hydra","hyena","hying","hymen","hymns","hyped","hyper","hypes","hypos","iambs","icier","icily","icing","icons","ideal","ideas","idiom","idiot","idled","idler","idles","idols","idyll","idyls","igloo","ikons","illus","image","imams","imbed","imbue","impel","imply","inane","inapt","inbox","inced","incur","index","indue","inept","inert","infer","infix","ingot","inked","inlay","inlet","inner","input","inset","intel","inter","intro","inure","ioctl","iotas","irate","irked","irons","irony","isles","islet","issue","itchy","items","ivies","ivory","jabot","jacks","jaded","jades","jails","jambs","japan","japed","japes","jaunt","jawed","jazzy","jeans","jeeps","jeers","jehad","jello","jells","jelly","jerks","jerky","jests","jetty","jewel","jibed","jibes","jiffy","jihad","jilts","jimmy","jinni","jinns","jived","jives","jocks","johns","joins","joint","joist","joked","joker","jokes","jolly","jolts","joule","joust","jowls","joyed","judge","juice","juicy","julep","jumbo","jumps","jumpy","junco","junks","junky","junta","juror","kabob","kapok","kaput","karat","karma","kayak","kazoo","kebab","kebob","keels","keens","keeps","ketch","keyed","khaki","khans","kicks","kicky","kiddo","kiddy","kills","kilns","kilos","kilts","kinda","kinds","kings","kinks","kinky","kiosk","kited","kites","kitty","kiwis","kluge","klutz","knack","knave","knead","kneed","kneel","knees","knell","knelt","knife","knits","knobs","knock","knoll","knots","known","knows","koala","koans","kooks","kooky","kopek","krone","kr\u00f3na","kudos","kudzu","label","labia","labor","laced","laces","lacks","laded","laden","lades","ladle","lager","lairs","laity","lakes","lamas","lambs","lamed","lamer","lames","lamps","lance","lands","lanes","lanky","lapel","lapse","larch","lards","large","largo","larks","larva","lased","laser","lases","lasso","lasts","latch","later","latex","lathe","laths","latte","lauds","laugh","lawns","laxer","laxly","layer","lazed","lazes","leach","leads","leafs","leafy","leaks","leaky","leans","leaps","leapt","learn","lease","leash","least","leave","ledge","leech","leeks","leers","leery","lefts","lefty","legal","leggy","legit","lemma","lemme","lemon","lemur","lends","leper","letup","levee","level","lever","lexer","liars","libel","licit","licks","liege","liens","lifer","lifts","light","liked","liken","liker","likes","lilac","lilts","limbo","limbs","limed","limes","limit","limns","limos","limps","lined","linen","liner","lines","lingo","links","lints","lions","lipid","liras","lisle","lisps","lists","liter","lithe","lived","liven","liver","lives","livid","llama","llano","loads","loafs","loamy","loans","loath","lobby","lobed","lobes","local","locks","locus","lodes","lodge","lofts","lofty","loges","logic","login","logon","logos","loins","lolls","loner","longs","looks","looms","loons","loony","loops","loopy","loose","loots","loped","lopes","lords","lorry","loser","loses","lotto","lotus","louse","lousy","louts","loved","lover","loves","lowed","lower","lowly","loxes","loyal","luaus","lubed","lubes","lucid","lucks","lucky","lucre","lulls","lumps","lumpy","lunar","lunch","lunge","lungs","lupin","lupus","lurch","lured","lures","lurid","lurks","lusts","lusty","lutes","lxvii","lying","lymph","lynch","lyres","lyric","macaw","maced","maces","macho","macro","madam","madly","magic","magma","maids","mails","maims","mains","maize","major","maker","makes","males","malls","malts","mamas","mambo","mamma","manes","manga","mange","mango","mangy","mania","manic","manly","manna","manor","manse","maple","march","mares","maria","marks","marry","marsh","marts","masks","mason","masts","match","mated","mates","matte","matts","matzo","mauls","mauve","maven","mavin","maxed","maxes","maxim","maybe","mayor","mazes","meals","mealy","means","meant","meats","meaty","mecca","medal","media","medic","meets","melds","melon","melts","memes","memos","mends","menus","meows","mercy","meres","merge","merit","merry","mesas","messy","metal","meted","meter","metes","metro","mewed","mewls","miaow","micra","middy","midge","midst","miens","miffs","might","miked","mikes","milch","miler","miles","milfs","milks","milky","mills","mimed","mimes","mimic","mince","minds","mined","miner","mines","minim","minis","minks","minor","mints","minty","minus","mired","mires","mirth","misdo","miser","mists","misty","miter","mites","mitts","mixed","mixer","mixes","moans","moats","mocha","mocks","modal","model","modem","modes","mogul","moire","moist","molar","molds","moldy","moles","molls","molts","momma","mommy","money","monks","month","mooch","moods","moody","mooed","moons","moors","moose","moots","moped","mopes","moral","moray","mores","morns","moron","mosey","mossy","motel","motes","moths","motif","motor","motto","mound","mount","mourn","mouse","mousy","mouth","moved","mover","moves","movie","mowed","mower","mucks","mucky","mucus","muddy","muffs","mufti","muggy","mulch","mules","mulls","multi","mummy","mumps","munch","mungs","mural","murks","murky","mused","muses","mushy","music","musky","mussy","musts","musty","muted","muter","mutes","mutts","mynah","mynas","myrrh","myths","m\u00eal\u00e9e","nabob","nacho","nacre","nadir","naiad","nails","naive","naked","named","names","nanny","napes","nappy","narcs","narks","nasal","nasty","natal","natty","naval","navel","naves","nears","neath","necks","needs","needy","neigh","nerds","nerdy","nerve","nervy","nests","never","newel","newer","newly","newsy","newts","nexus","nicer","niche","nicks","niece","nifty","nigga","night","nimbi","nines","ninja","ninny","ninth","nippy","niter","nites","nixed","nixes","noble","nobly","nodal","noddy","nodes","noels","noise","noisy","nomad","nonce","nooks","noose","norms","north","nosed","noses","nosey","notch","noted","notes","nouns","novae","novas","novel","noway","nuder","nudes","nudge","nuked","nukes","nulls","numbs","nurse","nutty","nylon","nymph","oaken","oakum","oared","oases","oasis","oaten","oaths","obese","obeys","obits","oboes","occur","ocean","ocher","ochre","octal","octet","odder","oddly","odium","odors","offal","offed","offer","often","ogled","ogles","ogres","oiled","oinks","okays","okras","olden","older","oldie","olive","omega","omens","omits","onion","onset","oozed","oozes","opals","opens","opera","opine","opium","opted","optic","orals","orate","orbit","order","organ","osier","other","otter","ought","ounce","ousts","outdo","outed","outer","outgo","outr\u00e9","ovals","ovary","ovens","overs","overt","ovoid","ovule","owing","owlet","owned","owner","oxbow","oxide","ozone","paced","paces","packs","pacts","paddy","padre","paean","pagan","paged","pager","pages","pails","pains","paint","pairs","paled","paler","pales","palls","palms","palmy","palsy","panda","panel","panes","pangs","panic","pansy","pants","panty","papal","papas","papaw","paper","parch","pared","pares","parka","parks","parry","parse","parts","party","pasha","pass\u00e9","pasta","paste","pasts","pasty","patch","pates","paths","patio","patsy","patty","pause","paved","paves","pawed","pawls","pawns","payed","payee","payer","peace","peach","peaks","peals","pearl","pears","pease","pecan","pecks","pedal","peeks","peels","peeps","peers","peeve","pekoe","pelts","penal","pence","pends","penes","penis","penny","peons","peony","peppy","perch","peril","perks","perky","perms","pesky","pesos","pests","petal","peter","petty","pewee","phage","phase","phial","phish","phlox","phone","phony","photo","phyla","piano","picks","picky","piece","piers","piety","piggy","pigmy","piing","piked","piker","pikes","pilaf","pilau","pilaw","piled","piles","pills","pilot","pimps","pinch","pined","pines","pings","pinks","pinky","pinto","pints","pinup","pious","piped","piper","pipes","pipit","pique","pitch","pithy","piton","pivot","pixel","pixie","pizza","place","plaid","plain","plait","plane","plank","plans","plant","plate","plays","plaza","plead","pleas","pleat","plied","plies","plods","plonk","plops","plots","plows","ploys","pluck","plugs","plumb","plume","plump","plums","plunk","plush","poach","pocks","podia","poems","poesy","poets","point","poise","poked","poker","pokes","pokey","polar","poled","poles","polio","polka","polls","polyp","ponds","pones","pooch","poohs","pools","poops","popes","poppa","poppy","porch","pored","pores","porno","ports","posed","poser","poses","posit","posse","posts","potty","pouch","pound","pours","pouts","power","poxes","prank","prate","prawn","prays","preen","preps","press","preys","price","prick","pricy","pride","pried","pries","prigs","prime","primp","print","prior","prism","privy","prize","probe","prods","profs","promo","proms","prone","prong","proof","props","prose","prosy","proud","prove","prowl","prows","proxy","prude","prune","psalm","pshaw","psych","pubic","pucks","pudgy","puffs","puffy","puked","pukes","pulls","pulps","pulpy","pulse","pumas","pumps","punch","punks","punts","pupae","pupal","pupas","pupil","puppy","puree","purer","purge","purls","purrs","purse","pushy","pussy","putts","putty","pwned","pygmy","pylon","pyres","pyxes","quack","quads","quaff","quail","quake","qualm","quark","quart","quash","quasi","quays","queen","queer","quell","query","quest","queue","quick","quids","quiet","quill","quilt","quine","quips","quire","quirk","quite","quits","quoit","quota","quote","quoth","rabbi","rabid","raced","racer","races","racks","radar","radii","radio","radon","rafts","ragas","raged","rages","raids","rails","rains","rainy","raise","rajah","rajas","raked","rakes","rally","ramps","ranch","randy","range","rangy","ranks","rants","raped","rapes","rapid","rared","rarer","rares","rasps","raspy","rated","rates","ratio","ratty","raved","ravel","raven","raves","rawer","rayon","razed","razes","razor","reach","react","reads","ready","realm","reals","reams","reaps","rearm","rears","rebel","rebus","rebut","recap","recta","recur","redid","reeds","reedy","reefs","reeks","reels","reeve","refer","refit","regal","rehab","reign","reins","relax","relay","relic","remit","renal","rends","renew","rents","reorg","repay","repel","reply","reran","rerun","reset","resin","rests","retch","retry","reuse","revel","revue","rheas","rheum","rhino","rhyme","riced","rices","ricks","rider","rides","ridge","rifer","riffs","rifle","rifts","right","rigid","rigor","riled","riles","rills","rimed","rimes","rinds","rings","rinks","rinse","riots","ripen","riper","risen","riser","rises","risks","risky","rites","ritzy","rival","riven","river","rivet","roach","roads","roams","roans","roars","roast","robed","robes","robin","robot","rocks","rocky","rodeo","roger","rogue","roils","roles","rolls","roman","romps","roods","roofs","rooks","rooms","roomy","roost","roots","roped","ropes","roses","rosin","rotor","rouge","rough","round","rouse","route","routs","rou\u00e9s","roved","rover","roves","rowdy","rowed","rowel","rower","royal","rubes","ruble","ruddy","ruder","ruffs","rugby","ruing","ruins","ruled","ruler","rules","rumba","rummy","rumor","rumps","runes","rungs","runic","runny","runts","rupee","rural","ruses","rusks","rusts","rusty","saber","sable","sabre","sacks","sades","sadly","safer","safes","sagas","sager","sages","sahib","sails","saint","saith","salad","sales","sally","salon","salsa","salts","salty","salve","salvo","samba","sames","sands","sandy","saner","sappy","saree","saris","sassy","satay","sated","sates","satin","satyr","sauce","saucy","sauna","saut\u00e9","saved","saver","saves","savor","savvy","sawed","saxes","scabs","scads","scags","scald","scale","scalp","scaly","scamp","scams","scans","scant","scare","scarf","scars","scary","scats","scene","scent","schwa","scion","scoff","scold","scone","scoop","scoot","scope","score","scorn","scour","scout","scowl","scows","scram","scrap","screw","scrip","scrod","scrog","scrub","scuba","scuds","scuff","scull","scums","scurf","seals","seams","seamy","sears","seats","sects","sedan","sedge","seeds","seedy","seeks","seems","seeps","seers","segue","seize","sells","semen","semis","sends","senna","sense","sepal","sepia","septa","serer","serfs","serge","serum","serve","servo","setup","seven","sever","sewed","sewer","sexed","sexes","shack","shade","shads","shady","shaft","shags","shahs","shake","shaky","shale","shall","shalt","shame","shams","shank","shape","shard","share","shark","sharp","shave","shawl","sheaf","shear","sheds","sheen","sheep","sheer","sheet","sheik","shelf","shell","sherd","shied","shies","shift","shill","shims","shine","shins","shiny","ships","shire","shirk","shirr","shirt","shits","shlep","shoal","shock","shoed","shoes","shone","shook","shoon","shoos","shoot","shops","shore","shorn","short","shots","shout","shove","shown","shows","showy","shred","shrew","shrub","shrug","shtik","shuck","shuns","shunt","shush","shuts","shyer","shyly","sibyl","sicks","sided","sides","sidle","siege","sieve","sifts","sighs","sight","sigma","signs","silks","silky","sills","silly","silos","silts","since","sinew","singe","sings","sinks","sinus","sired","siren","sires","sirup","sisal","sises","sissy","sitar","sited","sites","sixes","sixth","sixty","sized","sizer","sizes","skate","skeet","skein","skews","skids","skied","skier","skies","skiff","skill","skimp","skims","skins","skips","skirt","skits","skulk","skull","skunk","skyed","slabs","slack","slags","slain","slake","slams","slang","slant","slaps","slash","slate","slats","slave","slays","sleds","sleek","sleep","sleet","slept","slews","slice","slick","slide","slier","slily","slime","slims","slimy","sling","slink","slips","slits","slobs","sloes","slogs","sloop","slope","slops","slosh","sloth","slots","slows","slued","slues","slugs","slump","slums","slung","slunk","slurp","slurs","slush","sluts","slyer","slyly","smack","small","smart","smash","smear","smell","smelt","smile","smirk","smite","smith","smock","smoke","smoky","smote","smurf","smuts","snack","snafu","snags","snail","snake","snaky","snaps","snare","snarf","snark","snarl","sneak","sneer","snide","sniff","snipe","snips","snits","snobs","snoop","snoot","snore","snort","snots","snout","snows","snowy","snubs","snuck","snuff","snugs","soaks","soaps","soapy","soars","sober","socks","sodas","sofas","softy","soggy","soils","solar","soled","soles","solid","solos","solve","sonar","songs","sonic","sonny","sooth","sooty","soppy","sorer","sores","sorry","sorta","sorts","sough","souls","sound","soups","soupy","sours","souse","south","sowed","sower","space","spacy","spade","spake","spams","spank","spans","spare","spark","spars","spasm","spate","spats","spawn","spays","speak","spear","speck","specs","speed","spell","spelt","spend","spent","sperm","spews","spice","spicy","spied","spiel","spies","spike","spiky","spill","spilt","spine","spins","spiny","spire","spite","spits","splat","splay","split","spoil","spoke","spoof","spook","spool","spoon","spoor","spore","sport","spots","spout","sprat","spray","spree","sprig","spuds","spume","spunk","spurn","spurs","spurt","squab","squad","squat","squaw","squid","stabs","stack","staff","stage","stags","staid","stain","stair","stake","stale","stalk","stall","stamp","stand","stank","staph","stare","stark","stars","start","stash","state","stats","stave","stays","stdio","stead","steak","steal","steam","steed","steel","steep","steer","stein","stems","stent","steps","stern","stews","stick","sties","stiff","stile","still","stilt","sting","stink","stint","stirs","stoat","stock","stoic","stoke","stole","stomp","stone","stony","stood","stool","stoop","stops","store","stork","storm","story","stout","stove","stows","strap","straw","stray","strep","strew","strip","strop","strum","strut","stubs","stuck","studs","study","stuff","stump","stung","stunk","stuns","stunt","styes","style","styli","suave","sucks","sudsy","suede","sugar","suing","suite","suits","sulks","sulky","sully","sumac","sumps","sunny","sunup","super","surer","surfs","surge","surly","sushi","swabs","swags","swain","swami","swamp","swank","swans","swaps","sward","swarm","swash","swath","swats","sways","swear","sweat","sweep","sweet","swell","swept","swift","swigs","swill","swims","swine","swing","swipe","swirl","swish","swoon","swoop","swops","sword","swore","sworn","swung","sylph","synch","syncs","synod","syrup","sysop","tabby","table","taboo","tabus","tacit","tacks","tacky","tacos","taffy","tails","taint","taken","taker","takes","tales","talks","tally","talon","tamed","tamer","tames","tamps","tango","tangs","tangy","tanks","tansy","taped","taper","tapes","tapir","tardy","tared","tares","taros","tarot","tarps","tarry","tarts","taser","tasks","taste","tasty","tatty","taunt","taupe","tawny","taxed","taxes","taxis","teach","teaks","teals","teams","tears","teary","tease","teats","techs","teems","teens","teeny","teeth","telex","tells","tempi","tempo","temps","tempt","tends","tenet","tenon","tenor","tense","tenth","tents","tepee","tepid","terms","terns","terry","terse","tests","testy","texts","thank","thaws","thees","theft","their","theme","there","these","theta","thick","thief","thigh","thine","thing","think","thins","third","thong","thorn","those","thous","three","threw","throb","throe","throw","thrum","thuds","thugs","thumb","thump","thunk","thyme","thymi","tiara","tibia","ticks","tidal","tided","tides","tiers","tiffs","tiger","tight","tikes","tilde","tiled","tiles","tills","tilts","timed","timer","times","timid","tines","tinge","tings","tinny","tints","tipis","tipsy","tired","tires","tiros","titan","tithe","title","tizzy","toads","toady","toast","today","toddy","toffy","togae","togas","toils","toked","token","tokes","tolls","tombs","tomes","tonal","toned","toner","tones","tongs","tonic","tonne","tools","tooth","toots","topaz","topic","toque","torch","torsi","torso","torte","torts","torus","total","toted","totem","totes","touch","tough","tours","touts","towed","towel","tower","towns","toxic","toxin","toyed","trace","track","tract","trade","trail","train","trait","tramp","trams","trans","traps","trash","trawl","trays","tread","treas","treat","treed","trees","treks","trend","tress","triad","trial","tribe","trice","trick","tried","tries","trike","trill","trims","trios","tripe","trips","trite","troll","tromp","trons","troop","trope","troth","trots","trout","troys","truce","truck","trued","truer","trues","truly","trump","trunk","truss","trust","truth","tryst","tsars","tubas","tubby","tubed","tuber","tubes","tucks","tufts","tulip","tulle","tumid","tummy","tumor","tunas","tuned","tuner","tunes","tunic","tunny","turds","turfs","turns","tusks","tutor","tutus","tuxes","twain","twang","tweak","tweed","tweet","twerk","twerp","twice","twigs","twill","twine","twink","twins","twirl","twist","twits","tying","tykes","typed","types","typos","tyros","tzars","udder","ulcer","ulnae","ulnas","ultra","umbel","umber","umiak","umped","unbar","uncle","uncut","under","undid","undue","unfit","unify","union","unite","units","unity","unman","unpin","unsay","unset","untie","until","unwed","unzip","upend","upped","upper","upset","urban","urged","urges","urine","usage","users","usher","using","usual","usurp","usury","uteri","utter","uvula","vacua","vague","vales","valet","valid","valor","value","valve","vamps","vanes","vaped","vapes","vapid","vapor","vases","vasts","vault","vaunt","veeps","veers","vegan","veils","veins","velds","veldt","venal","vends","venom","vents","venue","verbs","verge","verse","verve","vests","vetch","vexed","vexes","vials","viand","vibes","vicar","viced","vices","video","views","vigil","vigor","viler","villa","vines","vinyl","viola","viols","viper","viral","vireo","virus","visas","vised","vises","visit","visor","vista","vital","vivas","vivid","vixen","vizor","vocal","vodka","vogue","voice","voids","voile","voles","volts","vomit","voted","voter","votes","vouch","vowed","vowel","vulva","vying","wacko","wacks","wacky","waded","wader","wades","wadis","wafer","wafts","waged","wager","wages","wagon","waifs","wails","waist","waits","waive","waked","waken","wakes","waldo","waled","wales","walks","walls","waltz","wands","waned","wanes","wanks","wanly","wanna","wants","wards","wares","warez","warms","warns","warps","warts","warty","wasps","waste","watch","water","watts","waved","waver","waves","waxed","waxen","waxes","weals","weans","wears","weary","weave","wedge","weeds","weedy","weeks","weeps","weepy","weest","wefts","weigh","weird","weirs","welch","welds","wells","welsh","welts","wench","wends","wetly","whack","whale","whams","wharf","whats","wheal","wheat","wheel","whelk","whelp","whens","where","whets","which","whiff","while","whims","whine","whiny","whips","whirl","whirr","whirs","whisk","whist","white","whits","whizz","whole","whoop","whore","whorl","whose","wicks","widen","wider","widow","width","wield","wight","wikis","wilds","wiled","wiles","wills","wilts","wimps","wimpy","wince","winch","winds","windy","wined","wines","wings","winks","winos","wiped","wiper","wipes","wired","wires","wiser","wises","wisps","wispy","witch","witty","wives","wizes","woken","wolfs","woman","wombs","women","wonky","woods","woody","wooed","wooer","woofs","wooly","woozy","words","wordy","works","world","worms","wormy","worry","worse","worst","worth","would","wound","woven","wowed","wrack","wraps","wrapt","wrath","wreak","wreck","wrens","wrest","wrier","wring","wrist","write","writs","wrong","wrote","wroth","wrung","wryer","wryly","xcvii","xenon","xrefs","xterm","xviii","xxiii","xxvii","xxxii","xxxiv","xxxix","xxxvi","xylem","yacht","yacks","yahoo","yanks","yards","yarns","yawed","yawls","yawns","yeahs","yearn","years","yeast","yells","yelps","yeses","yield","yocks","yodel","yogin","yogis","yoked","yokel","yokes","yolks","young","yours","youth","yowls","yucca","yucks","yucky","yummy","yuppy","zebra","zebus","zeros","zests","zilch","zincs","zings","zippy","zombi","zonal","zoned","zones","zooms","zorch","\u00e9clat","\u00e9p\u00e9es","\u00e9tude"]).forEach(function(w){ DF_GUESSES_SET[w] = true; });

  var KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

  var df = { answer:"", guesses:[], results:[], current:"", gameOver:false, won:false, keyStatus:{} };
  var dfMsgTimeout = null;

  function openDailyFive(){
    var today = todayStr();
    var idx = hashString("df-" + today) % DF_ANSWERS.length;
    df.answer = DF_ANSWERS[idx];
    df.current = "";
    df.keyStatus = {};

    var existing = (store.dailyLog.dailyfive || {})[today];
    if (existing){
      df.guesses = existing.guesses.slice();
      df.gameOver = true;
      df.won = existing.result === "win";
    } else {
      df.guesses = [];
      df.gameOver = false;
      df.won = false;
    }
    df.results = df.guesses.map(function(g){ return scoreDfGuess(g, df.answer); });
    df.results.forEach(function(r, i){ updateDfKeyStatus(df.guesses[i], r); });

    renderDfBoard();
    renderDfKeyboard();
    showDfMessage(df.gameOver ? (df.won ? "You got it!" : ("The word was " + df.answer.toUpperCase())) : "");
  }

  // Standard two-pass Wordle scoring: exact matches first, then present-elsewhere,
  // correctly handling duplicate letters via remaining-count bookkeeping.
  function scoreDfGuess(guess, answer){
    var result = new Array(5).fill("absent");
    var answerChars = answer.split("");
    var used = new Array(5).fill(false);
    for (var i=0;i<5;i++){
      if (guess[i] === answerChars[i]){ result[i] = "correct"; used[i] = true; }
    }
    for (var i=0;i<5;i++){
      if (result[i] === "correct") continue;
      for (var j=0;j<5;j++){
        if (!used[j] && guess[i] === answerChars[j]){
          result[i] = "present"; used[j] = true; break;
        }
      }
    }
    return result;
  }

  function updateDfKeyStatus(guess, result){
    for (var i=0;i<5;i++){
      var l = guess[i], r = result[i];
      var prev = df.keyStatus[l];
      if (r === "correct" || (r === "present" && prev !== "correct") || (!prev)){
        if (r === "correct") df.keyStatus[l] = "correct";
        else if (r === "present" && prev !== "correct") df.keyStatus[l] = "present";
        else if (!prev) df.keyStatus[l] = r;
      }
    }
  }

  function renderDfBoard(){
    var board = document.getElementById("dfBoard");
    board.innerHTML = "";
    for (var r=0;r<6;r++){
      var rowEl = document.createElement("div");
      rowEl.className = "df-row";
      var guess = df.guesses[r];
      var result = df.results[r];
      var displayWord = r === df.guesses.length ? df.current : (guess || "");
      for (var c=0;c<5;c++){
        var tile = document.createElement("div");
        var letter = displayWord[c] || "";
        var cls = "df-tile";
        if (letter && !guess) cls += " filled";
        if (result) cls += " " + result[c];
        tile.className = cls;
        tile.textContent = letter;
        rowEl.appendChild(tile);
      }
      board.appendChild(rowEl);
    }
  }

  function renderDfKeyboard(){
    var kb = document.getElementById("dfKeyboard");
    kb.innerHTML = "";
    KEYBOARD_ROWS.forEach(function(rowLetters, idx){
      var rowEl = document.createElement("div");
      rowEl.className = "df-krow";
      if (idx === 2){
        var enterKey = document.createElement("button");
        enterKey.className = "df-key wide";
        enterKey.textContent = "Enter";
        enterKey.addEventListener("click", submitDfGuess);
        rowEl.appendChild(enterKey);
      }
      rowLetters.split("").forEach(function(l){
        var key = document.createElement("button");
        key.className = "df-key" + (df.keyStatus[l] ? (" " + df.keyStatus[l]) : "");
        key.textContent = l;
        key.addEventListener("click", function(){ appendDfLetter(l); });
        rowEl.appendChild(key);
      });
      if (idx === 2){
        var delKey = document.createElement("button");
        delKey.className = "df-key wide";
        delKey.textContent = "Del";
        delKey.addEventListener("click", deleteDfLetter);
        rowEl.appendChild(delKey);
      }
      kb.appendChild(rowEl);
    });
  }

  function appendDfLetter(l){
    if (df.gameOver || df.current.length >= 5) return;
    df.current += l;
    renderDfBoard();
  }
  function deleteDfLetter(){
    if (df.gameOver) return;
    df.current = df.current.slice(0, -1);
    renderDfBoard();
  }
  function showDfMessage(text){
    var el = document.getElementById("dfMessage");
    el.textContent = text;
    if (dfMsgTimeout) clearTimeout(dfMsgTimeout);
    if (text && !df.gameOver) dfMsgTimeout = setTimeout(function(){ el.textContent = "\u00A0"; }, 1600);
  }

  function submitDfGuess(){
    if (df.gameOver) return;
    if (df.current.length !== 5){ showDfMessage("Not enough letters"); return; }
    if (!DF_GUESSES_SET[df.current]){ showDfMessage("Not in word list"); return; }

    var guess = df.current;
    var result = scoreDfGuess(guess, df.answer);
    df.guesses.push(guess);
    df.results.push(result);
    updateDfKeyStatus(guess, result);
    df.current = "";

    var won = result.every(function(r){ return r === "correct"; });
    var lost = !won && df.guesses.length >= 6;

    if (won || lost){
      df.gameOver = true;
      df.won = won;
      var points = won ? (7 - df.guesses.length) : 0;
      var today = todayStr();
      if (!store.dailyLog.dailyfive) store.dailyLog.dailyfive = {};
      store.dailyLog.dailyfive[today] = { score:points, maxPossible:6, guesses: df.guesses.slice(), result: won ? "win" : "loss" };
      if (!store.highScores.dailyfive || points > store.highScores.dailyfive){
        store.highScores.dailyfive = points;
      }
      saveStore();
      showDfMessage(won ? "You got it!" : ("The word was " + df.answer.toUpperCase()));
    }

    renderDfBoard();
    renderDfKeyboard();
  }

  document.getElementById("dfBackBtn").addEventListener("click", function(){ showPage("favoritesPage"); });
  document.addEventListener("keydown", function(e){
    if (!document.getElementById("dailyFivePage").classList.contains("active")) return;
    if (e.key === "Enter"){ submitDfGuess(); return; }
    if (e.key === "Backspace"){ deleteDfLetter(); return; }
    var k = e.key.toLowerCase();
    if (k.length === 1 && k >= "a" && k <= "z") appendDfLetter(k);
  });

  // ================= TILE MATCH ENGINE =================
  var TM_EMOJI = ["🍎","🍌","🍇","🍉","🍓","🍒","🥝","🍍","🥥","🍑","🍋","🥑","🍆","🌽","🥕","🍔","🍕","🌮","🍩","🎂","🍦"];
  var TM_DIFFICULTIES = [
    { id:"easy",   label:"Easy",   cols:4, pairs:10 },
    { id:"medium", label:"Medium", cols:5, pairs:15 },
    { id:"hard",   label:"Hard",   cols:6, pairs:21 }
  ];
  var TM_REVEAL_PAUSE_MS = 1500;
  var TM_STREAK_BONUS = 2;

  var tm = {
    difficulty: "easy", pairs: 10,
    board: [], firstIndex: null, secondIndex: null, locked: false,
    matchesFound: 0, points: 0, streak: 0, attemptCount: 0,
    startTimestamp: 0, elapsedMs: 0,
    timerInterval: null, gameOver: false
  };
  var tmMsgTimeout = null;
  var tmStatsFilter = null; // which difficulty's stats Statistics is currently showing

  function buildTileMatchDeck(pairCount){
    var pool = TM_EMOJI.slice(0, pairCount);
    var deck = pool.concat(pool);
    for (var i = deck.length - 1; i > 0; i--){
      var j = Math.floor(Math.random() * (i + 1));
      var t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    return deck.map(function(e){ return { emoji: e, state: "hidden" }; });
  }

  // Entry point from Favorites/New Games — always opens on the difficulty picker.
  function openTileMatch(){
    tm.difficulty = (store.settings && store.settings.tileMatchDifficulty) || "easy";
    showTmDifficultyPicker();
  }

  function showTmDifficultyPicker(){
    stopTileMatch();
    document.getElementById("tmOverlay").style.display = "none"; // hide the (unrelated) game-over overlay if it was showing
    document.getElementById("tmGrid").style.display = "none";
    document.getElementById("tmGrid").innerHTML = "";
    document.getElementById("tmTimer").textContent = "0:00";
    document.getElementById("tmPoints").textContent = "0";
    showTmMessage("");

    var row = document.createElement("div");
    row.className = "road-diff-row";
    TM_DIFFICULTIES.forEach(function(d){
      var btn = document.createElement("button");
      btn.className = "road-diff-btn" + (tm.difficulty === d.id ? " selected" : "");
      btn.textContent = d.label + " — " + d.pairs + " pairs";
      btn.addEventListener("click", function(){
        store.settings.tileMatchDifficulty = d.id;
        saveStore();
        startTileMatchGame(d.id);
      });
      row.appendChild(btn);
    });
    var btnsEl = document.getElementById("tmPickerButtons");
    btnsEl.innerHTML = "";
    btnsEl.appendChild(row);
    document.getElementById("tmPicker").style.display = "block";
  }

  function startTileMatchGame(difficultyId){
    var cfg = TM_DIFFICULTIES.filter(function(d){ return d.id === difficultyId; })[0] || TM_DIFFICULTIES[0];
    tm.difficulty = cfg.id;
    tm.pairs = cfg.pairs;
    tm.board = buildTileMatchDeck(cfg.pairs);
    tm.firstIndex = null;
    tm.secondIndex = null;
    tm.locked = false;
    tm.matchesFound = 0;
    tm.points = 0;
    tm.streak = 0;
    tm.attemptCount = 0;
    tm.gameOver = false;
    tm.startTimestamp = Date.now();
    tm.elapsedMs = 0;

    document.getElementById("tmPicker").style.display = "none";
    document.getElementById("tmGrid").style.display = "grid";
    document.getElementById("tmGrid").style.gridTemplateColumns = "repeat(" + cfg.cols + ",1fr)";
    document.getElementById("tmOverlay").style.display = "none";
    showTmMessage("");
    updateTmScoreDisplay();
    renderTmGrid();

    if (tm.timerInterval) clearInterval(tm.timerInterval);
    tm.timerInterval = setInterval(function(){
      if (tm.gameOver) return;
      tm.elapsedMs = Date.now() - tm.startTimestamp;
      document.getElementById("tmTimer").textContent = fmtTime(tm.elapsedMs);
    }, 500);
  }

  function stopTileMatch(){
    if (tm.timerInterval){ clearInterval(tm.timerInterval); tm.timerInterval = null; }
  }

  function renderTmGrid(){
    var grid = document.getElementById("tmGrid");
    grid.innerHTML = "";
    tm.board.forEach(function(tile, i){
      var el = document.createElement("div");
      el.className = "tm-tile " + tile.state;
      el.textContent = tile.state === "hidden" ? "" : tile.emoji;
      el.addEventListener("click", function(){ handleTmTileClick(i); });
      grid.appendChild(el);
    });
  }
  function renderTmTile(i){
    var grid = document.getElementById("tmGrid");
    var el = grid.children[i];
    var tile = tm.board[i];
    el.className = "tm-tile " + tile.state;
    el.textContent = tile.state === "hidden" ? "" : tile.emoji;
  }

  function showTmMessage(text){
    var el = document.getElementById("tmMessage");
    el.textContent = text || "\u00A0";
    if (tmMsgTimeout) clearTimeout(tmMsgTimeout);
    if (text) tmMsgTimeout = setTimeout(function(){ el.textContent = "\u00A0"; }, 2600);
  }
  function updateTmScoreDisplay(){
    document.getElementById("tmPoints").textContent = tm.points;
  }

  function handleTmTileClick(i){
    if (tm.locked || tm.gameOver) return;
    var tile = tm.board[i];
    if (tile.state !== "hidden") return;

    tile.state = "revealed";
    renderTmTile(i);

    if (tm.firstIndex === null){
      tm.firstIndex = i;
      return;
    }
    if (i === tm.firstIndex) return;

    tm.secondIndex = i;
    tm.attemptCount++; // this flip-pair counts as one attempt, whether it's a hit or a miss
    var isMatch = tm.board[tm.firstIndex].emoji === tm.board[tm.secondIndex].emoji;
    var attemptsForThisMatch = tm.attemptCount;
    var fIdx = tm.firstIndex, sIdx = tm.secondIndex;

    if (isMatch){
      // Resolve immediately — no lock, no pause. The player can go straight into their next guess.
      tm.board[fIdx].state = "matched";
      tm.board[sIdx].state = "matched";
      renderTmTile(fIdx);
      renderTmTile(sIdx);
      resolveTmMatch(attemptsForThisMatch);

      var gridEl = document.getElementById("tmGrid");
      [fIdx, sIdx].forEach(function(idx){
        var el = gridEl.children[idx];
        el.classList.add("flash");
        setTimeout(function(){ el.classList.remove("flash"); }, 700);
      });

      tm.firstIndex = null;
      tm.secondIndex = null;

      tm.matchesFound++;
      if (tm.matchesFound === tm.pairs) finishTileMatch();
    } else {
      // Only a miss needs the pause, so the player has time to see what was revealed.
      tm.locked = true;
      setTimeout(function(){
        tm.board[fIdx].state = "hidden";
        tm.board[sIdx].state = "hidden";
        tm.streak = 0;
        renderTmTile(fIdx);
        renderTmTile(sIdx);
        tm.firstIndex = null;
        tm.secondIndex = null;
        tm.locked = false;
      }, TM_REVEAL_PAUSE_MS);
    }
  }

  // Scored on how many attempts (flip-pairs) it took since the last successful match to
  // find this one: 1 attempt = 5pts, 2 = 4pts, 3 = 3pts, 4 = 2pts, 5+ always floors at 1pt.
  function resolveTmMatch(attempts){
    var pts = Math.max(1, 6 - attempts);

    tm.streak++;
    var msg = "Match Found in " + attempts + " Attempt" + (attempts === 1 ? "" : "s") + " (+" + pts + " point" + (pts === 1 ? "" : "s") + ")";
    // A 2+ streak triggers the bonus every match from the 2nd consecutive one onward —
    // so a 3-in-a-row streak fires it twice (at match 2 and again at match 3), matching
    // "three in a row counts as two consecutive two-in-a-rows."
    if (tm.streak >= 2){
      pts += TM_STREAK_BONUS;
      msg += " (+" + TM_STREAK_BONUS + " *Match Streak Bonus*)";
    }
    tm.points += pts;
    tm.attemptCount = 0; // reset the hunt for the next pair
    showTmMessage(msg);
    updateTmScoreDisplay();
  }

  function finishTileMatch(){
    tm.gameOver = true;
    stopTileMatch();
    tm.elapsedMs = Date.now() - tm.startTimestamp;
    document.getElementById("tmTimer").textContent = fmtTime(tm.elapsedMs);

    var rec = store.tileMatchRecord[tm.difficulty];
    rec.played++;
    if (rec.bestTimeMs === null || tm.elapsedMs < rec.bestTimeMs) rec.bestTimeMs = tm.elapsedMs;
    if (tm.points > rec.bestPoints) rec.bestPoints = tm.points;
    saveStore();

    document.getElementById("tmOverlayTitle").textContent = "All matched!";
    document.getElementById("tmOverlaySub").textContent = "Finished in " + fmtTime(tm.elapsedMs) + " with " + tm.points + " points.";

    var row = document.createElement("div");
    row.className = "road-choice-row";
    var again = document.createElement("button");
    again.className = "road-choice-btn primary";
    again.textContent = "Play Again";
    again.addEventListener("click", function(){ startTileMatchGame(tm.difficulty); });
    var change = document.createElement("button");
    change.className = "road-choice-btn secondary";
    change.textContent = "Return to Main Menu";
    change.addEventListener("click", function(){ showPage("favoritesPage"); });
    row.appendChild(again);
    row.appendChild(change);
    var btnsEl = document.getElementById("tmOverlayButtons");
    btnsEl.innerHTML = "";
    btnsEl.appendChild(row);
    document.getElementById("tmOverlay").style.display = "flex";
  }

  document.getElementById("tmBackBtn").addEventListener("click", function(){ showPage("favoritesPage"); });
  document.getElementById("tmNewGameBtn").addEventListener("click", function(){ showPage("favoritesPage"); });

  // ================= BLACKJACK ENGINE =================
  // Reuses Solitaire's deck/suit/rank helpers (SUITS, solBuildDeck, solShuffle,
  // solIsRed, solRankLabel, solSuitSymbol) so the cards read identically.
  var bj = { deck: [], playerHand: [], dealerHand: [], state: "betting", bet: 0, pendingBet: 0 };
  var bjDealerTimeout = null;

  function bjHandValue(hand){
    var total = 0, aces = 0;
    hand.forEach(function(c){
      var v = c.rank === 1 ? 11 : c.rank >= 11 ? 10 : c.rank;
      if (c.rank === 1) aces++;
      total += v;
    });
    while (total > 21 && aces > 0){ total -= 10; aces--; }
    return total;
  }
  function bjVisibleValue(hand){
    return bjHandValue(hand.filter(function(c){ return c.faceUp; }));
  }
  function formatMoney(amount){
    amount = Math.round(amount * 100) / 100; // guard against float artifacts like 12.499999999
    var isWhole = Math.abs(amount - Math.round(amount)) < 0.001;
    return "$" + (isWhole ? Math.round(amount) : amount.toFixed(2));
  }

  function openBlackjack(){
    if (store.blackjackBalance === undefined || store.blackjackBalance === null) store.blackjackBalance = 100;
    bjGoToBetting();
  }

  function bjGoToBetting(){
    if (bjDealerTimeout){ clearTimeout(bjDealerTimeout); bjDealerTimeout = null; }
    bj.state = "betting";
    bj.pendingBet = 0;
    bj.playerHand = [];
    bj.dealerHand = [];
    showBjMessage(store.blackjackBalance > 0 ? "Place your bet." : "You're out of chips!");
    renderBjTable();
    renderBjUIState();
  }

  function bjAddChip(value){
    if (bj.state !== "betting") return;
    if (bj.pendingBet + value > store.blackjackBalance) return;
    bj.pendingBet += value;
    renderBjUIState();
  }
  function bjClearBet(){
    if (bj.state !== "betting") return;
    bj.pendingBet = 0;
    renderBjUIState();
  }
  function bjResetBalance(){
    store.blackjackBalance = 100;
    saveStore();
    bjGoToBetting();
  }

  function bjDealCard(hand, faceUp){
    if (bj.deck.length === 0) bj.deck = solShuffle(solBuildDeck());
    var card = bj.deck.pop();
    card.faceUp = faceUp;
    hand.push(card);
  }

  function bjDeal(){
    if (bj.state !== "betting" || bj.pendingBet <= 0) return;
    bj.bet = bj.pendingBet;
    store.blackjackBalance -= bj.bet;
    saveStore();

    if (bj.deck.length < 15) bj.deck = solShuffle(solBuildDeck()); // reshuffle before running low
    bj.playerHand = [];
    bj.dealerHand = [];
    bj.state = "playerTurn";
    bjDealCard(bj.playerHand, true);
    bjDealCard(bj.dealerHand, true);
    bjDealCard(bj.playerHand, true);
    bjDealCard(bj.dealerHand, false);

    showBjMessage("Your move — hit or stand.");
    renderBjTable();
    renderBjUIState();

    var playerBJ = bjHandValue(bj.playerHand) === 21;
    var dealerBJ = bjHandValue(bj.dealerHand) === 21;
    if (playerBJ || dealerBJ){
      bj.dealerHand.forEach(function(c){ c.faceUp = true; });
      bj.state = "roundOver";
      var result = playerBJ && dealerBJ ? "push" : playerBJ ? "blackjack" : "lose";
      bjFinishRound(result);
    }
  }

  function bjHit(){
    if (bj.state !== "playerTurn") return;
    bjDealCard(bj.playerHand, true);
    renderBjTable();
    if (bjHandValue(bj.playerHand) > 21){
      bj.dealerHand.forEach(function(c){ c.faceUp = true; });
      bj.state = "roundOver";
      bjFinishRound("bust");
    } else {
      showBjMessage("Your move — hit or stand.");
    }
  }

  function bjStand(){
    if (bj.state !== "playerTurn") return;
    bj.state = "dealerTurn";
    bj.dealerHand.forEach(function(c){ c.faceUp = true; });
    renderBjTable();
    renderBjUIState();
    showBjMessage("Dealer is playing…");
    bjDealerTimeout = setTimeout(bjDealerPlay, 650);
  }

  function bjDealerPlay(){
    var val = bjHandValue(bj.dealerHand);
    if (val < 17){
      bjDealCard(bj.dealerHand, true);
      renderBjTable();
      bjDealerTimeout = setTimeout(bjDealerPlay, 650);
      return;
    }
    bj.state = "roundOver";
    var playerVal = bjHandValue(bj.playerHand);
    var result;
    if (val > 21) result = "dealerbust";
    else if (val > playerVal) result = "lose";
    else if (val < playerVal) result = "win";
    else result = "push";
    bjFinishRound(result);
  }

  // Payouts: win/dealer-bust return the wager plus an equal win (1:1). A natural blackjack
  // on the first two cards pays 3:2 (wager back plus 1.5x). A push just returns the wager.
  // A loss/bust keeps the wager, which was already deducted at deal time.
  function bjFinishRound(result){
    var msg;
    switch (result){
      case "blackjack":
        msg = "Blackjack! You win 3:2.";
        store.blackjackBalance += bj.bet * 2.5;
        store.blackjackRecord.wins++; store.blackjackRecord.blackjacks++;
        break;
      case "win":
        msg = "You win!";
        store.blackjackBalance += bj.bet * 2;
        store.blackjackRecord.wins++;
        break;
      case "dealerbust":
        msg = "Dealer busts — you win!";
        store.blackjackBalance += bj.bet * 2;
        store.blackjackRecord.wins++;
        break;
      case "lose":
        msg = "Dealer wins.";
        store.blackjackRecord.losses++;
        break;
      case "bust":
        msg = "Bust! You lose.";
        store.blackjackRecord.losses++;
        break;
      case "push":
        msg = "Push — it's a tie.";
        store.blackjackBalance += bj.bet;
        store.blackjackRecord.pushes++;
        break;
    }
    saveStore();
    showBjMessage(msg);
    renderBjTable();
    renderBjUIState();
  }

  function bjCardEl(card){
    var el = document.createElement("div");
    if (card.faceUp){
      el.className = "bj-card " + (solIsRed(card) ? "red" : "black");
      el.innerHTML = "<div>" + solRankLabel(card.rank) + "</div><div class=\"bj-suit\">" + solSuitSymbol(card.suit) + "</div>";
    } else {
      el.className = "bj-card facedown";
    }
    return el;
  }

  function renderBjTable(){
    var dealerEl = document.getElementById("bjDealerHand");
    dealerEl.innerHTML = "";
    bj.dealerHand.forEach(function(c){ dealerEl.appendChild(bjCardEl(c)); });
    document.getElementById("bjDealerValue").textContent = bj.dealerHand.length
      ? (bj.state === "playerTurn" ? bjVisibleValue(bj.dealerHand) : bjHandValue(bj.dealerHand))
      : "";

    var playerEl = document.getElementById("bjPlayerHand");
    playerEl.innerHTML = "";
    bj.playerHand.forEach(function(c){ playerEl.appendChild(bjCardEl(c)); });
    document.getElementById("bjPlayerValue").textContent = bj.playerHand.length ? bjHandValue(bj.playerHand) : "";

    document.getElementById("bjBalance").textContent = formatMoney(store.blackjackBalance);
  }

  // Handles all button/section visibility for the current state (betting / playing / round over).
  function renderBjUIState(){
    var betting = bj.state === "betting";
    var playing = bj.state === "playerTurn";
    var over = bj.state === "roundOver";

    document.getElementById("bjBetting").style.display = betting ? "block" : "none";
    document.getElementById("bjPlayRow").style.display = playing ? "flex" : "none";
    document.getElementById("bjNewHandBtn").style.display = over ? "" : "none";

    document.getElementById("bjCurrentBet").textContent = formatMoney(bj.pendingBet);
    document.getElementById("bjDealBtn").disabled = bj.pendingBet <= 0;
    [1,5,10].forEach(function(v){
      document.getElementById("bjChip" + v).disabled = (bj.pendingBet + v) > store.blackjackBalance;
    });
    document.getElementById("bjResetBalanceBtn").style.display = (betting && store.blackjackBalance <= 0) ? "" : "none";
  }

  function showBjMessage(text){
    document.getElementById("bjMessage").textContent = text || "\u00A0";
  }

  document.getElementById("bjBackBtn").addEventListener("click", function(){
    if (bjDealerTimeout){ clearTimeout(bjDealerTimeout); bjDealerTimeout = null; }
    showPage("favoritesPage");
  });
  document.getElementById("bjHitBtn").addEventListener("click", bjHit);
  document.getElementById("bjStandBtn").addEventListener("click", bjStand);
  document.getElementById("bjNewHandBtn").addEventListener("click", bjGoToBetting);
  document.getElementById("bjChip1").addEventListener("click", function(){ bjAddChip(1); });
  document.getElementById("bjChip5").addEventListener("click", function(){ bjAddChip(5); });
  document.getElementById("bjChip10").addEventListener("click", function(){ bjAddChip(10); });
  document.getElementById("bjClearBetBtn").addEventListener("click", bjClearBet);
  document.getElementById("bjDealBtn").addEventListener("click", bjDeal);
  document.getElementById("bjResetBalanceBtn").addEventListener("click", bjResetBalance);

  // ================= BASKETBALL DRAFT =================
  // A note on the data: this is a genuinely small, hand-verified starter set — NOT a
  // full historical database. Each seeded team/era lists real rotation players from that
  // team's real history, one primary position each. Everything else shows an honest
  // "not available yet" state rather than invented rosters. Add more entries to
  // BBALL_ROSTERS below (same {era: {city: [{name,pos}]}} shape) to expand this later.
  var BBALL_ERAS = ["1960s","1970s","1980s","1990s","2000s","2010s","2020s"];
  var BBALL_TEAMS = [
    "Atlanta","Boston","Brooklyn","Charlotte","Chicago","Cleveland","Dallas","Denver",
    "Detroit","Golden State","Houston","Indiana","Los Angeles L","Los Angeles C",
    "Memphis","Miami","Milwaukee","Minnesota","New Orleans","New York","Oklahoma City",
    "Orlando","Philadelphia","Phoenix","Portland","Sacramento","San Antonio","Toronto",
    "Utah","Washington"
  ];
  var BBALL_POSITIONS = ["PG","SG","SF","PF","C"];

  var BBALL_ROSTERS = {
    "1970s": {
      // Atlantic Division — 1970s
      "Boston": [
        { name:"John Havlicek", pos:"PG" },
        { name:"Jo Jo White", pos:"SG" },
        { name:"Paul Westphal", pos:"SG" },
        { name:"Don Chaney", pos:"SF" },
        { name:"Don Nelson", pos:"PF" },
        { name:"Paul Silas", pos:"PF" },
        { name:"Dave Cowens", pos:"C" }
      ],
      "Brooklyn": [
        { name:"Brian Taylor", pos:"PG" },
        { name:"John Williamson", pos:"SG" },
        { name:"Julius Erving", pos:"SF" },
        { name:"Larry Kenon", pos:"PF" },
        { name:"Billy Paultz", pos:"C" }
      ],
      "New York": [
        { name:"Walt Frazier", pos:"PG" },
        { name:"Earl Monroe", pos:"SG" },
        { name:"Bill Bradley", pos:"SF" },
        { name:"Dave DeBusschere", pos:"PF" },
        { name:"Willis Reed", pos:"C" }
      ],
      "Philadelphia": [
        { name:"Henry Bibby", pos:"PG" },
        { name:"Doug Collins", pos:"SG" },
        { name:"World B. Free", pos:"SG" },
        { name:"Julius Erving", pos:"SF" },
        { name:"George McGinnis", pos:"PF" },
        { name:"Caldwell Jones", pos:"C" }
      ],
      // Northwest Division — 1970s
      "Denver": [
        { name:"Mack Calvin", pos:"PG" },
        { name:"Ted McClain", pos:"PG" },
        { name:"David Thompson", pos:"SG" },
        { name:"Brian Taylor", pos:"SG" },
        { name:"Bobby Jones", pos:"SF" },
        { name:"Anthony Roberts", pos:"SF" },
        { name:"Willie Wise", pos:"PF" },
        { name:"Paul Silas", pos:"PF" },
        { name:"Dan Issel", pos:"C" },
        { name:"Marvin Webster", pos:"C" }
      ],
      "Portland": [
        { name:"Lionel Hollins", pos:"PG" },
        { name:"Dave Twardzik", pos:"PG" },
        { name:"Johnny Davis", pos:"SG" },
        { name:"Geoff Petrie", pos:"SG" },
        { name:"Bob Gross", pos:"SF" },
        { name:"Sidney Wicks", pos:"PF" },
        { name:"Maurice Lucas", pos:"PF" },
        { name:"Bill Walton", pos:"C" }
      ],
      "Oklahoma City": [
        { name:"Gus Williams", pos:"PG" },
        { name:"Fred Brown", pos:"PG" },
        { name:"Dennis Johnson", pos:"SG" },
        { name:"Dick Snyder", pos:"SG" },
        { name:"John Johnson", pos:"SF" },
        { name:"Wally Walker", pos:"SF" },
        { name:"Lonnie Shelton", pos:"PF" },
        { name:"Paul Silas", pos:"PF" },
        { name:"Jack Sikma", pos:"C" },
        { name:"Dennis Awtrey", pos:"C" }
      ],
      "Utah": [
        { name:"Gail Goodrich", pos:"PG" },
        { name:"Ron Lee", pos:"PG" },
        { name:"Pete Maravich", pos:"SG" },
        { name:"James McElroy", pos:"SG" },
        { name:"Spencer Haywood", pos:"SF" },
        { name:"Ira Terrell", pos:"SF" },
        { name:"Truck Robinson", pos:"PF" },
        { name:"Aaron James", pos:"PF" },
        { name:"Rich Kelley", pos:"C" },
        { name:"Joe C. Meriweather", pos:"C" }
      ],
      // Pacific Division — 1970s
      "Los Angeles L": [
        { name:"Jerry West", pos:"PG" },
        { name:"Lucius Allen", pos:"PG" },
        { name:"Gail Goodrich", pos:"SG" },
        { name:"Cazzie Russell", pos:"SG" },
        { name:"Jamaal Wilkes", pos:"SF" },
        { name:"Jim McMillian", pos:"SF" },
        { name:"Happy Hairston", pos:"PF" },
        { name:"Elgin Baylor", pos:"SF" },
        { name:"Wilt Chamberlain", pos:"C" },
        { name:"Kareem Abdul-Jabbar", pos:"C" }
      ],
      "Los Angeles C": [
        { name:"Randy Smith", pos:"PG" },
        { name:"Ernie DiGregorio", pos:"PG" },
        { name:"Adrian Dantley", pos:"SF" },
        { name:"Gar Heard", pos:"SF" },
        { name:"Jim McMillian", pos:"SF" },
        { name:"John Shumate", pos:"PF" },
        { name:"Swen Nater", pos:"C" },
        { name:"Bob McAdoo", pos:"C" }
      ],
      "Golden State": [
        { name:"Charles Johnson", pos:"PG" },
        { name:"Phil Smith", pos:"SG" },
        { name:"Jeff Mullins", pos:"SG" },
        { name:"Rick Barry", pos:"SF" },
        { name:"Jamaal Wilkes", pos:"SF" },
        { name:"Clifford Ray", pos:"C" },
        { name:"Nate Thurmond", pos:"C" },
        { name:"George Johnson", pos:"C" }
      ],
      "Phoenix": [
        { name:"Charlie Scott", pos:"PG" },
        { name:"Dick Van Arsdale", pos:"SG" },
        { name:"Paul Westphal", pos:"SG" },
        { name:"Connie Hawkins", pos:"SF" },
        { name:"Gar Heard", pos:"PF" },
        { name:"Curtis Perry", pos:"PF" },
        { name:"Alvan Adams", pos:"C" }
      ],
      "Sacramento": [
        { name:"Nate Archibald", pos:"PG" },
        { name:"Jimmy Walker", pos:"SG" },
        { name:"Scott Wedman", pos:"SF" },
        { name:"Ron Behagen", pos:"PF" },
        { name:"Sam Lacey", pos:"C" }
      ],
      // Southwest Division — 1970s (Dallas/Memphis/New Orleans didn't exist yet as these franchises)
      "San Antonio": [
        { name:"James Silas", pos:"PG" },
        { name:"Mike Gale", pos:"PG" },
        { name:"George Gervin", pos:"SG" },
        { name:"Larry Kenon", pos:"SF" },
        { name:"Mark Olberding", pos:"PF" },
        { name:"Billy Paultz", pos:"C" },
        { name:"Coby Dietrick", pos:"C" }
      ],
      "Houston": [
        { name:"Calvin Murphy", pos:"PG" },
        { name:"Mike Newlin", pos:"SG" },
        { name:"Rudy Tomjanovich", pos:"SF" },
        { name:"John Johnson", pos:"SF" },
        { name:"Kevin Kunnert", pos:"PF" },
        { name:"Dwight Jones", pos:"PF" },
        { name:"Moses Malone", pos:"C" }
      ],
      // Central Division — 1970s
      "Chicago": [
        { name:"Norm Van Lier", pos:"PG" },
        { name:"Jerry Sloan", pos:"SG" },
        { name:"Matt Guokas", pos:"SG" },
        { name:"Chet Walker", pos:"SF" },
        { name:"Bob Love", pos:"PF" },
        { name:"Nate Thurmond", pos:"C" },
        { name:"Tom Boerwinkle", pos:"C" }
      ],
      "Cleveland": [
        { name:"Jim Cleamons", pos:"PG" },
        { name:"Dick Snyder", pos:"SG" },
        { name:"Bingo Smith", pos:"SG" },
        { name:"Austin Carr", pos:"SG" },
        { name:"Campy Russell", pos:"SF" },
        { name:"Jim Brewer", pos:"PF" },
        { name:"Jim Chones", pos:"C" }
      ],
      "Detroit": [
        { name:"Dave Bing", pos:"PG" },
        { name:"Chris Ford", pos:"SG" },
        { name:"Curtis Rowe", pos:"SF" },
        { name:"Don Adams", pos:"PF" },
        { name:"Bob Lanier", pos:"C" }
      ],
      "Indiana": [
        { name:"Don Buse", pos:"PG" },
        { name:"John Williamson", pos:"SG" },
        { name:"Billy Knight", pos:"SF" },
        { name:"Darnell Hillman", pos:"PF" },
        { name:"Dave Robisch", pos:"C" }
      ],
      "Milwaukee": [
        { name:"Oscar Robertson", pos:"PG" },
        { name:"Lucius Allen", pos:"PG" },
        { name:"Jon McGlocklin", pos:"SG" },
        { name:"Bob Dandridge", pos:"SF" },
        { name:"Greg Smith", pos:"PF" },
        { name:"Bob Boozer", pos:"PF" },
        { name:"Kareem Abdul-Jabbar", pos:"C" }
      ],
      "Washington": [
        { name:"Tom Henderson", pos:"PG" },
        { name:"Kevin Grevey", pos:"SG" },
        { name:"Bob Dandridge", pos:"SF" },
        { name:"Elvin Hayes", pos:"PF" },
        { name:"Wes Unseld", pos:"C" },
        { name:"Mitch Kupchak", pos:"C" }
      ]
    },
    "1980s": {
      // Southeast Division — 1980s
      "Atlanta": [
        { name:"Doc Rivers", pos:"PG" },
        { name:"Spud Webb", pos:"PG" },
        { name:"Randy Wittman", pos:"SG" },
        { name:"Dominique Wilkins", pos:"SF" },
        { name:"Cliff Levingston", pos:"PF" },
        { name:"Kevin Willis", pos:"PF" },
        { name:"Tree Rollins", pos:"C" }
      ],
      "Charlotte": [
        { name:"Muggsy Bogues", pos:"PG" },
        { name:"Rex Chapman", pos:"SG" },
        { name:"Kelly Tripucka", pos:"SF" },
        { name:"Robert Reid", pos:"SF" },
        { name:"Kurt Rambis", pos:"PF" },
        { name:"Earl Cureton", pos:"C" }
      ],
      "Miami": [
        { name:"Sherman Douglas", pos:"PG" },
        { name:"Kevin Edwards", pos:"SG" },
        { name:"Glen Rice", pos:"SF" },
        { name:"Billy Thompson", pos:"SF" },
        { name:"Grant Long", pos:"PF" },
        { name:"Tellis Frank", pos:"PF" },
        { name:"Rony Seikaly", pos:"C" }
      ],
      "Orlando": [
        { name:"Scott Skiles", pos:"PG" },
        { name:"Reggie Theus", pos:"SG" },
        { name:"Nick Anderson", pos:"SG" },
        { name:"Terry Catledge", pos:"SF" },
        { name:"Sidney Green", pos:"PF" },
        { name:"Mark Acres", pos:"C" }
      ],
      "Washington": [
        { name:"John Lucas", pos:"PG" },
        { name:"Kevin Grevey", pos:"SG" },
        { name:"Greg Ballard", pos:"SF" },
        { name:"Jeff Ruland", pos:"PF" },
        { name:"Rick Mahorn", pos:"C" }
      ],
      "Boston": [
        { name:"Dennis Johnson", pos:"PG" },
        { name:"Gerald Henderson", pos:"PG" },
        { name:"Nate Archibald", pos:"PG" },
        { name:"Jerry Sichting", pos:"PG" },
        { name:"Danny Ainge", pos:"SG" },
        { name:"Chris Ford", pos:"SG" },
        { name:"Larry Bird", pos:"SF" },
        { name:"Scott Wedman", pos:"SF" },
        { name:"Cedric Maxwell", pos:"PF" },
        { name:"Kevin McHale", pos:"PF" },
        { name:"Robert Parish", pos:"C" },
        { name:"Bill Walton", pos:"C" },
        { name:"Rick Robey", pos:"C" },
        { name:"Greg Kite", pos:"C" }
      ],
      "Brooklyn": [
        { name:"Micheal Ray Richardson", pos:"PG" },
        { name:"Otis Birdsong", pos:"SG" },
        { name:"Albert King", pos:"SF" },
        { name:"Buck Williams", pos:"PF" },
        { name:"Darryl Dawkins", pos:"C" }
      ],
      "New York": [
        { name:"Rory Sparrow", pos:"PG" },
        { name:"Trent Tucker", pos:"SG" },
        { name:"Bernard King", pos:"SF" },
        { name:"Louis Orr", pos:"PF" },
        { name:"Pat Cummings", pos:"C" }
      ],
      "Philadelphia": [
        { name:"Maurice Cheeks", pos:"PG" },
        { name:"Andrew Toney", pos:"SG" },
        { name:"Julius Erving", pos:"SF" },
        { name:"Bobby Jones", pos:"PF" },
        { name:"Moses Malone", pos:"C" }
      ],
      // Northwest Division — 1980s
      "Denver": [
        { name:"Fat Lever", pos:"PG" },
        { name:"T.R. Dunn", pos:"SG" },
        { name:"David Thompson", pos:"SG" },
        { name:"Alex English", pos:"SF" },
        { name:"Calvin Natt", pos:"PF" },
        { name:"Kiki Vandeweghe", pos:"PF" },
        { name:"Dan Issel", pos:"C" },
        { name:"Wayne Cooper", pos:"C" },
        { name:"Danny Schayes", pos:"C" }
      ],
      "Oklahoma City": [
        { name:"Gus Williams", pos:"PG" },
        { name:"Fred Brown", pos:"PG" },
        { name:"Al Wood", pos:"SG" },
        { name:"Dale Ellis", pos:"SG" },
        { name:"Xavier McDaniel", pos:"SF" },
        { name:"Tom Chambers", pos:"PF" },
        { name:"Danny Vranes", pos:"PF" },
        { name:"Jack Sikma", pos:"C" }
      ],
      "Portland": [
        { name:"Fat Lever", pos:"PG" },
        { name:"Darnell Valentine", pos:"PG" },
        { name:"Jim Paxson", pos:"SG" },
        { name:"Clyde Drexler", pos:"SG" },
        { name:"Kiki Vandeweghe", pos:"SF" },
        { name:"Jerome Kersey", pos:"SF" },
        { name:"Kenny Carr", pos:"PF" },
        { name:"Mychal Thompson", pos:"PF" },
        { name:"Sam Bowie", pos:"C" },
        { name:"Steve Johnson", pos:"C" }
      ],
      "Utah": [
        { name:"Rickey Green", pos:"PG" },
        { name:"John Stockton", pos:"PG" },
        { name:"Darrell Griffith", pos:"SG" },
        { name:"Adrian Dantley", pos:"SF" },
        { name:"Bobby Hansen", pos:"SF" },
        { name:"Thurl Bailey", pos:"PF" },
        { name:"Karl Malone", pos:"PF" },
        { name:"Mark Eaton", pos:"C" },
        { name:"Rich Kelley", pos:"C" }
      ],
      // Pacific Division — 1980s
      "Los Angeles L": [
        { name:"Magic Johnson", pos:"PG" },
        { name:"Norm Nixon", pos:"PG" },
        { name:"Byron Scott", pos:"SG" },
        { name:"Michael Cooper", pos:"SG" },
        { name:"James Worthy", pos:"SF" },
        { name:"Jamaal Wilkes", pos:"SF" },
        { name:"Kurt Rambis", pos:"PF" },
        { name:"A.C. Green", pos:"PF" },
        { name:"Kareem Abdul-Jabbar", pos:"C" },
        { name:"Mychal Thompson", pos:"C" }
      ],
      "Los Angeles C": [
        { name:"Norm Nixon", pos:"PG" },
        { name:"World B. Free", pos:"SG" },
        { name:"Derek Smith", pos:"SG" },
        { name:"Junior Bridgeman", pos:"SG" },
        { name:"Terry Cummings", pos:"PF" },
        { name:"Michael Cage", pos:"PF" },
        { name:"Bill Walton", pos:"C" }
      ],
      "Golden State": [
        { name:"Sleepy Floyd", pos:"PG" },
        { name:"World B. Free", pos:"SG" },
        { name:"Purvis Short", pos:"SF" },
        { name:"Chris Mullin", pos:"SF" },
        { name:"Larry Smith", pos:"PF" },
        { name:"Joe Barry Carroll", pos:"C" },
        { name:"Terry Teagle", pos:"SG" }
      ],
      "Phoenix": [
        { name:"Kyle Macy", pos:"PG" },
        { name:"Jay Humphries", pos:"PG" },
        { name:"Walter Davis", pos:"SG" },
        { name:"Larry Nance", pos:"PF" },
        { name:"Maurice Lucas", pos:"PF" },
        { name:"Alvan Adams", pos:"C" },
        { name:"James Edwards", pos:"C" }
      ],
      "Sacramento": [
        { name:"Kenny Smith", pos:"PG" },
        { name:"Reggie Theus", pos:"SG" },
        { name:"Mike Woodson", pos:"SG" },
        { name:"Eddie Johnson", pos:"SF" },
        { name:"Otis Thorpe", pos:"PF" },
        { name:"LaSalle Thompson", pos:"C" }
      ],
      // Southwest Division — 1980s (Memphis/New Orleans didn't exist yet as these franchises)
      "Dallas": [
        { name:"Derek Harper", pos:"PG" },
        { name:"Brad Davis", pos:"PG" },
        { name:"Rolando Blackman", pos:"SG" },
        { name:"Mark Aguirre", pos:"SF" },
        { name:"Sam Perkins", pos:"PF" },
        { name:"Roy Tarpley", pos:"PF" },
        { name:"James Donaldson", pos:"C" }
      ],
      "Houston": [
        { name:"John Lucas", pos:"PG" },
        { name:"Lewis Lloyd", pos:"SG" },
        { name:"Rodney McCray", pos:"SF" },
        { name:"Robert Reid", pos:"SF" },
        { name:"Ralph Sampson", pos:"PF" },
        { name:"Jim Petersen", pos:"PF" },
        { name:"Hakeem Olajuwon", pos:"C" }
      ],
      "San Antonio": [
        { name:"Johnny Moore", pos:"PG" },
        { name:"Mike Dunleavy", pos:"PG" },
        { name:"George Gervin", pos:"SG" },
        { name:"Mike Mitchell", pos:"SF" },
        { name:"Gene Banks", pos:"PF" },
        { name:"Edgar Jones", pos:"PF" },
        { name:"Artis Gilmore", pos:"C" }
      ],
      "Chicago": [
        { name:"John Paxson", pos:"PG" },
        { name:"Sam Vincent", pos:"PG" },
        { name:"Michael Jordan", pos:"SG" },
        { name:"Scottie Pippen", pos:"SF" },
        { name:"Charles Oakley", pos:"PF" },
        { name:"Horace Grant", pos:"PF" },
        { name:"Dave Corzine", pos:"C" }
      ],
      "Cleveland": [
        { name:"Mark Price", pos:"PG" },
        { name:"Ron Harper", pos:"SG" },
        { name:"Craig Ehlo", pos:"SF" },
        { name:"Larry Nance", pos:"PF" },
        { name:"Brad Daugherty", pos:"C" }
      ],
      "Detroit": [
        { name:"Isiah Thomas", pos:"PG" },
        { name:"Joe Dumars", pos:"SG" },
        { name:"Vinnie Johnson", pos:"SG" },
        { name:"Dennis Rodman", pos:"SF" },
        { name:"Rick Mahorn", pos:"PF" },
        { name:"Bill Laimbeer", pos:"C" },
        { name:"James Edwards", pos:"C" }
      ],
      "Indiana": [
        { name:"Vern Fleming", pos:"PG" },
        { name:"Reggie Miller", pos:"SG" },
        { name:"Chuck Person", pos:"SF" },
        { name:"Detlef Schrempf", pos:"PF" },
        { name:"Rik Smits", pos:"C" }
      ],
      "Milwaukee": [
        { name:"Sidney Moncrief", pos:"PG" },
        { name:"Paul Pressey", pos:"SG" },
        { name:"Marques Johnson", pos:"SF" },
        { name:"Junior Bridgeman", pos:"SF" },
        { name:"Alton Lister", pos:"PF" },
        { name:"Bob Lanier", pos:"C" }
      ]
    },
    "1990s": {
      "Boston": [
        { name:"Dee Brown", pos:"PG" },
        { name:"Reggie Lewis", pos:"SG" },
        { name:"Larry Bird", pos:"SF" },
        { name:"Kevin McHale", pos:"PF" },
        { name:"Robert Parish", pos:"C" }
      ],
      "Brooklyn": [
        { name:"Sam Cassell", pos:"PG" },
        { name:"Kerry Kittles", pos:"SG" },
        { name:"Keith Van Horn", pos:"SF" },
        { name:"Kendall Gill", pos:"PF" },
        { name:"Jayson Williams", pos:"C" }
      ],
      "New York": [
        { name:"Derek Harper", pos:"PG" },
        { name:"John Starks", pos:"SG" },
        { name:"Anthony Mason", pos:"SF" },
        { name:"Charles Oakley", pos:"PF" },
        { name:"Patrick Ewing", pos:"C" }
      ],
      "Philadelphia": [
        { name:"Allen Iverson", pos:"PG" },
        { name:"Jerry Stackhouse", pos:"SG" },
        { name:"Clarence Weatherspoon", pos:"SF" },
        { name:"Derrick Coleman", pos:"PF" },
        { name:"Michael Cage", pos:"C" }
      ],
      "Toronto": [
        { name:"Damon Stoudamire", pos:"PG" },
        { name:"Doug Christie", pos:"SG" },
        { name:"Tracy Murray", pos:"SF" },
        { name:"Tony Massenburg", pos:"PF" },
        { name:"Oliver Miller", pos:"C" }
      ],
      "Atlanta": [
        { name:"Mookie Blaylock", pos:"PG" },
        { name:"Steve Smith", pos:"SG" },
        { name:"Alan Henderson", pos:"SF" },
        { name:"Christian Laettner", pos:"PF" },
        { name:"Dikembe Mutombo", pos:"C" }
      ],
      "Charlotte": [
        { name:"Muggsy Bogues", pos:"PG" },
        { name:"Hersey Hawkins", pos:"SG" },
        { name:"Dell Curry", pos:"SF" },
        { name:"Larry Johnson", pos:"PF" },
        { name:"Alonzo Mourning", pos:"C" }
      ],
      "Miami": [
        { name:"Tim Hardaway", pos:"PG" },
        { name:"Voshon Lenard", pos:"SG" },
        { name:"Dan Majerle", pos:"SF" },
        { name:"P.J. Brown", pos:"PF" },
        { name:"Alonzo Mourning", pos:"C" }
      ],
      "Orlando": [
        { name:"Penny Hardaway", pos:"PG" },
        { name:"Nick Anderson", pos:"SG" },
        { name:"Dennis Scott", pos:"SG" },
        { name:"Donald Royal", pos:"SF" },
        { name:"Horace Grant", pos:"PF" },
        { name:"Shaquille O'Neal", pos:"C" }
      ],
      "Washington": [
        { name:"Rod Strickland", pos:"PG" },
        { name:"Calbert Cheaney", pos:"SG" },
        { name:"Tracy Murray", pos:"SF" },
        { name:"Juwan Howard", pos:"PF" },
        { name:"Chris Webber", pos:"C" }
      ],
      "Chicago": [
        { name:"John Paxson", pos:"PG" },
        { name:"B.J. Armstrong", pos:"PG" },
        { name:"Ron Harper", pos:"PG" },
        { name:"Randy Brown", pos:"PG" },
        { name:"Michael Jordan", pos:"SG" },
        { name:"Steve Kerr", pos:"SG" },
        { name:"Craig Hodges", pos:"SG" },
        { name:"Scottie Pippen", pos:"SF" },
        { name:"Toni Kukoč", pos:"SF" },
        { name:"Horace Grant", pos:"PF" },
        { name:"Dennis Rodman", pos:"PF" },
        { name:"Stacey King", pos:"PF" },
        { name:"Jud Buechler", pos:"PF" },
        { name:"Bill Cartwright", pos:"C" },
        { name:"Will Perdue", pos:"C" },
        { name:"Luc Longley", pos:"C" },
        { name:"Bill Wennington", pos:"C" }
      ],
      "Cleveland": [
        { name:"Mark Price", pos:"PG" },
        { name:"Terrell Brandon", pos:"PG" },
        { name:"Craig Ehlo", pos:"SF" },
        { name:"John Williams", pos:"PF" },
        { name:"Larry Nance", pos:"PF" },
        { name:"Brad Daugherty", pos:"C" }
      ],
      "Detroit": [
        { name:"Isiah Thomas", pos:"PG" },
        { name:"Joe Dumars", pos:"SG" },
        { name:"Vinnie Johnson", pos:"SG" },
        { name:"Mark Aguirre", pos:"SF" },
        { name:"Dennis Rodman", pos:"PF" },
        { name:"Bill Laimbeer", pos:"C" },
        { name:"James Edwards", pos:"C" }
      ],
      "Indiana": [
        { name:"Mark Jackson", pos:"PG" },
        { name:"Reggie Miller", pos:"SG" },
        { name:"Chris Mullin", pos:"SF" },
        { name:"Dale Davis", pos:"PF" },
        { name:"Rik Smits", pos:"C" }
      ],
      "Milwaukee": [
        { name:"Terrell Brandon", pos:"PG" },
        { name:"Ray Allen", pos:"SG" },
        { name:"Glenn Robinson", pos:"SF" },
        { name:"Tim Thomas", pos:"PF" },
        { name:"Ervin Johnson", pos:"C" }
      ],
      // Northwest Division — 1990s
      "Denver": [
        { name:"Mahmoud Abdul-Rauf", pos:"PG" },
        { name:"Robert Pack", pos:"PG" },
        { name:"Bryant Stith", pos:"SG" },
        { name:"Reggie Williams", pos:"SG" },
        { name:"LaPhonso Ellis", pos:"SF" },
        { name:"Antonio McDyess", pos:"PF" },
        { name:"Popeye Jones", pos:"PF" },
        { name:"Dikembe Mutombo", pos:"C" }
      ],
      "Minnesota": [
        { name:"Micheal Williams", pos:"PG" },
        { name:"Stephon Marbury", pos:"PG" },
        { name:"Doug West", pos:"SG" },
        { name:"Isaiah Rider", pos:"SG" },
        { name:"Tom Gugliotta", pos:"SF" },
        { name:"Kevin Garnett", pos:"PF" },
        { name:"Christian Laettner", pos:"PF" },
        { name:"Felton Spencer", pos:"C" }
      ],
      "Oklahoma City": [
        { name:"Gary Payton", pos:"PG" },
        { name:"Nate McMillan", pos:"PG" },
        { name:"Hersey Hawkins", pos:"SG" },
        { name:"Dale Ellis", pos:"SG" },
        { name:"Detlef Schrempf", pos:"SF" },
        { name:"Vincent Askew", pos:"SF" },
        { name:"Shawn Kemp", pos:"PF" },
        { name:"Sam Perkins", pos:"PF" },
        { name:"Ervin Johnson", pos:"C" }
      ],
      "Portland": [
        { name:"Terry Porter", pos:"PG" },
        { name:"Rod Strickland", pos:"PG" },
        { name:"Clyde Drexler", pos:"SG" },
        { name:"Danny Ainge", pos:"SG" },
        { name:"Jerome Kersey", pos:"SF" },
        { name:"Buck Williams", pos:"PF" },
        { name:"Cliff Robinson", pos:"PF" },
        { name:"Kevin Duckworth", pos:"C" },
        { name:"Arvydas Sabonis", pos:"C" }
      ],
      "Utah": [
        { name:"John Stockton", pos:"PG" },
        { name:"Howard Eisley", pos:"PG" },
        { name:"Jeff Hornacek", pos:"SG" },
        { name:"Bryon Russell", pos:"SF" },
        { name:"Adam Keefe", pos:"SF" },
        { name:"Karl Malone", pos:"PF" },
        { name:"Antoine Carr", pos:"PF" },
        { name:"Greg Ostertag", pos:"C" },
        { name:"Mark Eaton", pos:"C" }
      ],
      // Pacific Division — 1990s
      "Los Angeles L": [
        { name:"Magic Johnson", pos:"PG" },
        { name:"Nick Van Exel", pos:"PG" },
        { name:"Byron Scott", pos:"SG" },
        { name:"Eddie Jones", pos:"SG" },
        { name:"Kobe Bryant", pos:"SG" },
        { name:"Cedric Ceballos", pos:"SF" },
        { name:"A.C. Green", pos:"PF" },
        { name:"Elden Campbell", pos:"PF" },
        { name:"Vlade Divac", pos:"C" },
        { name:"Shaquille O'Neal", pos:"C" }
      ],
      "Los Angeles C": [
        { name:"Mark Jackson", pos:"PG" },
        { name:"Pooh Richardson", pos:"PG" },
        { name:"Ron Harper", pos:"SG" },
        { name:"Malik Sealy", pos:"SF" },
        { name:"Lamond Murray", pos:"SF" },
        { name:"Rodney Rogers", pos:"PF" },
        { name:"Danny Manning", pos:"PF" },
        { name:"Loy Vaught", pos:"PF" }
      ],
      "Golden State": [
        { name:"Tim Hardaway", pos:"PG" },
        { name:"Mitch Richmond", pos:"SG" },
        { name:"Latrell Sprewell", pos:"SG" },
        { name:"Sarunas Marciulionis", pos:"SG" },
        { name:"Chris Mullin", pos:"SF" },
        { name:"Billy Owens", pos:"SF" },
        { name:"Chris Webber", pos:"PF" }
      ],
      "Phoenix": [
        { name:"Kevin Johnson", pos:"PG" },
        { name:"Jason Kidd", pos:"PG" },
        { name:"Dan Majerle", pos:"SG" },
        { name:"Danny Ainge", pos:"SG" },
        { name:"Tom Chambers", pos:"SF" },
        { name:"A.C. Green", pos:"PF" },
        { name:"Charles Barkley", pos:"PF" }
      ],
      "Sacramento": [
        { name:"Bobby Hurley", pos:"PG" },
        { name:"Mitch Richmond", pos:"SG" },
        { name:"Walt Williams", pos:"SF" },
        { name:"Lionel Simmons", pos:"SF" },
        { name:"Billy Owens", pos:"SF" },
        { name:"Olden Polynice", pos:"C" }
      ],
      // Southwest Division — 1990s (New Orleans didn't exist yet as this franchise)
      "Dallas": [
        { name:"Jason Kidd", pos:"PG" },
        { name:"Scott Brooks", pos:"PG" },
        { name:"Jim Jackson", pos:"SG" },
        { name:"Lucious Harris", pos:"SG" },
        { name:"Jamal Mashburn", pos:"SF" },
        { name:"Popeye Jones", pos:"PF" },
        { name:"Roy Tarpley", pos:"C" }
      ],
      "Houston": [
        { name:"Kenny Smith", pos:"PG" },
        { name:"Sam Cassell", pos:"PG" },
        { name:"Vernon Maxwell", pos:"SG" },
        { name:"Robert Horry", pos:"SF" },
        { name:"Mario Elie", pos:"SF" },
        { name:"Otis Thorpe", pos:"PF" },
        { name:"Hakeem Olajuwon", pos:"C" }
      ],
      "San Antonio": [
        { name:"Avery Johnson", pos:"PG" },
        { name:"Vinny Del Negro", pos:"SG" },
        { name:"Sean Elliott", pos:"SF" },
        { name:"Chuck Person", pos:"SF" },
        { name:"Dennis Rodman", pos:"PF" },
        { name:"J.R. Reid", pos:"PF" },
        { name:"David Robinson", pos:"C" }
      ],
      "Memphis": [
        { name:"Lee Mayberry", pos:"PG" },
        { name:"Antonio Daniels", pos:"SG" },
        { name:"Blue Edwards", pos:"SG" },
        { name:"George Lynch", pos:"SF" },
        { name:"Shareef Abdur-Rahim", pos:"PF" },
        { name:"Otis Thorpe", pos:"PF" },
        { name:"Bryant Reeves", pos:"C" }
      ]
    },
    "2000s": {
      "Boston": [
        { name:"Rajon Rondo", pos:"PG" },
        { name:"Ray Allen", pos:"SG" },
        { name:"Paul Pierce", pos:"SF" },
        { name:"Kevin Garnett", pos:"PF" },
        { name:"Kendrick Perkins", pos:"C" }
      ],
      "Brooklyn": [
        { name:"Jason Kidd", pos:"PG" },
        { name:"Kerry Kittles", pos:"SG" },
        { name:"Richard Jefferson", pos:"SF" },
        { name:"Kenyon Martin", pos:"PF" },
        { name:"Jason Collins", pos:"C" }
      ],
      "New York": [
        { name:"Charlie Ward", pos:"PG" },
        { name:"Allan Houston", pos:"SG" },
        { name:"Latrell Sprewell", pos:"SF" },
        { name:"Larry Johnson", pos:"PF" },
        { name:"Marcus Camby", pos:"C" }
      ],
      "Philadelphia": [
        { name:"Allen Iverson", pos:"PG" },
        { name:"Aaron McKie", pos:"SG" },
        { name:"Eric Snow", pos:"SF" },
        { name:"Tyrone Hill", pos:"PF" },
        { name:"Dikembe Mutombo", pos:"C" }
      ],
      "Toronto": [
        { name:"Doug Christie", pos:"PG" },
        { name:"Vince Carter", pos:"SG" },
        { name:"Tracy McGrady", pos:"SF" },
        { name:"Antonio Davis", pos:"PF" },
        { name:"Charles Oakley", pos:"C" }
      ],
      "Atlanta": [
        { name:"Mike Bibby", pos:"PG" },
        { name:"Joe Johnson", pos:"SG" },
        { name:"Marvin Williams", pos:"SF" },
        { name:"Josh Smith", pos:"PF" },
        { name:"Al Horford", pos:"C" }
      ],
      "Charlotte": [
        { name:"Raymond Felton", pos:"PG" },
        { name:"D.J. Augustin", pos:"PG" },
        { name:"Stephen Jackson", pos:"SG" },
        { name:"Gerald Wallace", pos:"SF" },
        { name:"Boris Diaw", pos:"PF" },
        { name:"Nazr Mohammed", pos:"C" }
      ],
      "Miami": [
        { name:"Jason Williams", pos:"PG" },
        { name:"Dwyane Wade", pos:"SG" },
        { name:"Antoine Walker", pos:"SF" },
        { name:"Udonis Haslem", pos:"PF" },
        { name:"Shaquille O'Neal", pos:"C" }
      ],
      "Orlando": [
        { name:"Jameer Nelson", pos:"PG" },
        { name:"Courtney Lee", pos:"SG" },
        { name:"Hedo Türkoğlu", pos:"SF" },
        { name:"Rashard Lewis", pos:"PF" },
        { name:"Dwight Howard", pos:"C" }
      ],
      "Washington": [
        { name:"Gilbert Arenas", pos:"PG" },
        { name:"DeShawn Stevenson", pos:"SG" },
        { name:"Caron Butler", pos:"SF" },
        { name:"Antawn Jamison", pos:"PF" },
        { name:"Brendan Haywood", pos:"C" }
      ],
      "Los Angeles L": [
        { name:"Derek Fisher", pos:"PG" },
        { name:"Brian Shaw", pos:"PG" },
        { name:"Smush Parker", pos:"PG" },
        { name:"Jordan Farmar", pos:"PG" },
        { name:"Kobe Bryant", pos:"SG" },
        { name:"Sasha Vujačić", pos:"SG" },
        { name:"Rick Fox", pos:"SF" },
        { name:"Devean George", pos:"SF" },
        { name:"Trevor Ariza", pos:"SF" },
        { name:"Luke Walton", pos:"SF" },
        { name:"Robert Horry", pos:"PF" },
        { name:"Lamar Odom", pos:"PF" },
        { name:"Horace Grant", pos:"PF" },
        { name:"Vladimir Radmanović", pos:"PF" },
        { name:"A.C. Green", pos:"PF" },
        { name:"Shaquille O'Neal", pos:"C" },
        { name:"Kwame Brown", pos:"C" },
        { name:"Chris Mihm", pos:"C" },
        { name:"Pau Gasol", pos:"C" },
        { name:"Andrew Bynum", pos:"C" }
      ],
      // Northwest Division — 2000s
      "Denver": [
        { name:"Andre Miller", pos:"PG" },
        { name:"Anthony Carter", pos:"PG" },
        { name:"Earl Boykins", pos:"PG" },
        { name:"Allen Iverson", pos:"SG" },
        { name:"J.R. Smith", pos:"SG" },
        { name:"Carmelo Anthony", pos:"SF" },
        { name:"Linas Kleiza", pos:"SF" },
        { name:"Kenyon Martin", pos:"PF" },
        { name:"Eduardo Nájera", pos:"PF" },
        { name:"Nenê", pos:"PF" },
        { name:"Marcus Camby", pos:"C" }
      ],
      "Minnesota": [
        { name:"Terrell Brandon", pos:"PG" },
        { name:"Sam Cassell", pos:"PG" },
        { name:"Wally Szczerbiak", pos:"SG" },
        { name:"Latrell Sprewell", pos:"SG" },
        { name:"Trenton Hassell", pos:"SF" },
        { name:"Kevin Garnett", pos:"PF" },
        { name:"Mark Madsen", pos:"PF" },
        { name:"Rasho Nesterović", pos:"C" }
      ],
      "Oklahoma City": [
        { name:"Gary Payton", pos:"PG" },
        { name:"Earl Watson", pos:"PG" },
        { name:"Ray Allen", pos:"SG" },
        { name:"Antonio Daniels", pos:"SG" },
        { name:"Rashard Lewis", pos:"SF" },
        { name:"Kevin Durant", pos:"SF" },
        { name:"Vladimir Radmanović", pos:"PF" },
        { name:"Nick Collison", pos:"PF" },
        { name:"Jerome James", pos:"C" },
        { name:"Johan Petro", pos:"C" }
      ],
      "Portland": [
        { name:"Damon Stoudamire", pos:"PG" },
        { name:"Sebastian Telfair", pos:"PG" },
        { name:"Bonzi Wells", pos:"SG" },
        { name:"Derek Anderson", pos:"SG" },
        { name:"Ruben Patterson", pos:"SF" },
        { name:"Travis Outlaw", pos:"SF" },
        { name:"Rasheed Wallace", pos:"PF" },
        { name:"Zach Randolph", pos:"PF" },
        { name:"Dale Davis", pos:"C" },
        { name:"Joel Przybilla", pos:"C" }
      ],
      "Utah": [
        { name:"Carlos Arroyo", pos:"PG" },
        { name:"Deron Williams", pos:"PG" },
        { name:"Raja Bell", pos:"SG" },
        { name:"DeShawn Stevenson", pos:"SG" },
        { name:"Andrei Kirilenko", pos:"SF" },
        { name:"Matt Harpring", pos:"SF" },
        { name:"Karl Malone", pos:"PF" },
        { name:"Carlos Boozer", pos:"PF" },
        { name:"Mehmet Okur", pos:"C" },
        { name:"Greg Ostertag", pos:"C" }
      ],
      // Pacific Division — 2000s
      "Los Angeles C": [
        { name:"Sam Cassell", pos:"PG" },
        { name:"Shaun Livingston", pos:"PG" },
        { name:"Cuttino Mobley", pos:"SG" },
        { name:"Quentin Richardson", pos:"SF" },
        { name:"Corey Maggette", pos:"SF" },
        { name:"Elton Brand", pos:"PF" },
        { name:"Chris Kaman", pos:"C" }
      ],
      "Golden State": [
        { name:"Baron Davis", pos:"PG" },
        { name:"Monta Ellis", pos:"PG" },
        { name:"Jason Richardson", pos:"SG" },
        { name:"Stephen Jackson", pos:"SG" },
        { name:"Al Harrington", pos:"PF" },
        { name:"Troy Murphy", pos:"PF" },
        { name:"Andris Biedrins", pos:"C" }
      ],
      "Phoenix": [
        { name:"Steve Nash", pos:"PG" },
        { name:"Leandro Barbosa", pos:"SG" },
        { name:"Joe Johnson", pos:"SG" },
        { name:"Shawn Marion", pos:"SF" },
        { name:"Quentin Richardson", pos:"SF" },
        { name:"Boris Diaw", pos:"PF" },
        { name:"Amar'e Stoudemire", pos:"C" }
      ],
      "Sacramento": [
        { name:"Mike Bibby", pos:"PG" },
        { name:"Bobby Jackson", pos:"PG" },
        { name:"Doug Christie", pos:"SG" },
        { name:"Peja Stojaković", pos:"SF" },
        { name:"Chris Webber", pos:"PF" },
        { name:"Vlade Divac", pos:"C" }
      ],
      // Southwest Division — 2000s
      "Dallas": [
        { name:"Devin Harris", pos:"PG" },
        { name:"Jason Terry", pos:"SG" },
        { name:"Jerry Stackhouse", pos:"SG" },
        { name:"Josh Howard", pos:"SF" },
        { name:"Marquis Daniels", pos:"SF" },
        { name:"Dirk Nowitzki", pos:"PF" },
        { name:"Erick Dampier", pos:"C" }
      ],
      "Houston": [
        { name:"Rafer Alston", pos:"PG" },
        { name:"Tracy McGrady", pos:"SG" },
        { name:"Bonzi Wells", pos:"SG" },
        { name:"Shane Battier", pos:"SF" },
        { name:"Luis Scola", pos:"PF" },
        { name:"Chuck Hayes", pos:"PF" },
        { name:"Yao Ming", pos:"C" }
      ],
      "San Antonio": [
        { name:"Tony Parker", pos:"PG" },
        { name:"Manu Ginóbili", pos:"SG" },
        { name:"Brent Barry", pos:"SG" },
        { name:"Bruce Bowen", pos:"SF" },
        { name:"Tim Duncan", pos:"PF" },
        { name:"Robert Horry", pos:"PF" },
        { name:"Rasho Nesterović", pos:"C" }
      ],
      "Memphis": [
        { name:"Damon Stoudamire", pos:"PG" },
        { name:"Bobby Jackson", pos:"PG" },
        { name:"Mike Miller", pos:"SG" },
        { name:"Eddie Jones", pos:"SG" },
        { name:"Shane Battier", pos:"SF" },
        { name:"Pau Gasol", pos:"PF" },
        { name:"Lorenzen Wright", pos:"C" }
      ],
      "New Orleans": [
        { name:"Chris Paul", pos:"PG" },
        { name:"Jannero Pargo", pos:"PG" },
        { name:"Morris Peterson", pos:"SG" },
        { name:"Bobby Jackson", pos:"SG" },
        { name:"Peja Stojaković", pos:"SF" },
        { name:"David West", pos:"PF" },
        { name:"Tyson Chandler", pos:"C" }
      ],
      "Chicago": [
        { name:"Kirk Hinrich", pos:"PG" },
        { name:"Chris Duhon", pos:"PG" },
        { name:"Ben Gordon", pos:"SG" },
        { name:"Luol Deng", pos:"SF" },
        { name:"Andrés Nocioni", pos:"PF" },
        { name:"P.J. Brown", pos:"PF" },
        { name:"Ben Wallace", pos:"C" }
      ],
      "Cleveland": [
        { name:"Eric Snow", pos:"PG" },
        { name:"Larry Hughes", pos:"SG" },
        { name:"Sasha Pavlovic", pos:"SG" },
        { name:"LeBron James", pos:"SF" },
        { name:"Drew Gooden", pos:"PF" },
        { name:"Zydrunas Ilgauskas", pos:"C" }
      ],
      "Detroit": [
        { name:"Chauncey Billups", pos:"PG" },
        { name:"Richard Hamilton", pos:"SG" },
        { name:"Tayshaun Prince", pos:"SF" },
        { name:"Rasheed Wallace", pos:"PF" },
        { name:"Ben Wallace", pos:"C" }
      ],
      "Indiana": [
        { name:"Jamaal Tinsley", pos:"PG" },
        { name:"Reggie Miller", pos:"SG" },
        { name:"Ron Artest", pos:"SF" },
        { name:"Al Harrington", pos:"PF" },
        { name:"Jermaine O'Neal", pos:"C" }
      ],
      "Milwaukee": [
        { name:"Sam Cassell", pos:"PG" },
        { name:"Ray Allen", pos:"SG" },
        { name:"Glenn Robinson", pos:"SF" },
        { name:"Tim Thomas", pos:"PF" },
        { name:"Ervin Johnson", pos:"C" }
      ]
    },
    "2010s": {
      "Boston": [
        { name:"Kyrie Irving", pos:"PG" },
        { name:"Terry Rozier", pos:"SG" },
        { name:"Jaylen Brown", pos:"SF" },
        { name:"Jayson Tatum", pos:"SF" },
        { name:"Marcus Morris", pos:"PF" },
        { name:"Al Horford", pos:"C" }
      ],
      "Brooklyn": [
        { name:"Deron Williams", pos:"PG" },
        { name:"Joe Johnson", pos:"SG" },
        { name:"Paul Pierce", pos:"SF" },
        { name:"Kevin Garnett", pos:"PF" },
        { name:"Brook Lopez", pos:"C" }
      ],
      "New York": [
        { name:"Raymond Felton", pos:"PG" },
        { name:"J.R. Smith", pos:"SG" },
        { name:"Carmelo Anthony", pos:"SF" },
        { name:"Jason Kidd", pos:"PF" },
        { name:"Tyson Chandler", pos:"C" }
      ],
      "Philadelphia": [
        { name:"Ben Simmons", pos:"PG" },
        { name:"JJ Redick", pos:"SG" },
        { name:"Jimmy Butler", pos:"SF" },
        { name:"Tobias Harris", pos:"PF" },
        { name:"Joel Embiid", pos:"C" }
      ],
      "Toronto": [
        { name:"Kyle Lowry", pos:"PG" },
        { name:"Danny Green", pos:"SG" },
        { name:"Kawhi Leonard", pos:"SF" },
        { name:"Pascal Siakam", pos:"PF" },
        { name:"Marc Gasol", pos:"C" }
      ],
      "Atlanta": [
        { name:"Jeff Teague", pos:"PG" },
        { name:"Kyle Korver", pos:"SG" },
        { name:"DeMarre Carroll", pos:"SF" },
        { name:"Paul Millsap", pos:"PF" },
        { name:"Al Horford", pos:"C" }
      ],
      "Charlotte": [
        { name:"Kemba Walker", pos:"PG" },
        { name:"Gerald Henderson", pos:"SG" },
        { name:"Michael Kidd-Gilchrist", pos:"SF" },
        { name:"Josh McRoberts", pos:"PF" },
        { name:"Al Jefferson", pos:"C" }
      ],
      "Miami": [
        { name:"Mario Chalmers", pos:"PG" },
        { name:"Dwyane Wade", pos:"SG" },
        { name:"LeBron James", pos:"SF" },
        { name:"Chris Bosh", pos:"PF" },
        { name:"Chris Andersen", pos:"C" }
      ],
      "Orlando": [
        { name:"D.J. Augustin", pos:"PG" },
        { name:"Evan Fournier", pos:"SG" },
        { name:"Terrence Ross", pos:"SF" },
        { name:"Aaron Gordon", pos:"PF" },
        { name:"Nikola Vučević", pos:"C" }
      ],
      "Washington": [
        { name:"John Wall", pos:"PG" },
        { name:"Bradley Beal", pos:"SG" },
        { name:"Otto Porter Jr.", pos:"SF" },
        { name:"Markieff Morris", pos:"PF" },
        { name:"Marcin Gortat", pos:"C" }
      ],
      // Northwest Division — 2010s
      "Denver": [
        { name:"Ty Lawson", pos:"PG" },
        { name:"Jamal Murray", pos:"PG" },
        { name:"Gary Harris", pos:"SG" },
        { name:"Randy Foye", pos:"SG" },
        { name:"Danilo Gallinari", pos:"SF" },
        { name:"Wilson Chandler", pos:"SF" },
        { name:"Kenneth Faried", pos:"PF" },
        { name:"Paul Millsap", pos:"PF" },
        { name:"Nikola Jokić", pos:"C" },
        { name:"JaVale McGee", pos:"C" }
      ],
      "Minnesota": [
        { name:"Ricky Rubio", pos:"PG" },
        { name:"Jeff Teague", pos:"PG" },
        { name:"Zach LaVine", pos:"SG" },
        { name:"Andrew Wiggins", pos:"SG" },
        { name:"Shabazz Muhammad", pos:"SF" },
        { name:"Nemanja Bjelica", pos:"PF" },
        { name:"Kevin Garnett", pos:"PF" },
        { name:"Karl-Anthony Towns", pos:"C" },
        { name:"Gorgui Dieng", pos:"C" }
      ],
      "Oklahoma City": [
        { name:"Russell Westbrook", pos:"PG" },
        { name:"James Harden", pos:"SG" },
        { name:"Thabo Sefolosha", pos:"SG" },
        { name:"Kevin Durant", pos:"SF" },
        { name:"Andre Roberson", pos:"SF" },
        { name:"Serge Ibaka", pos:"PF" },
        { name:"Nick Collison", pos:"PF" },
        { name:"Kendrick Perkins", pos:"C" },
        { name:"Steven Adams", pos:"C" }
      ],
      "Portland": [
        { name:"Damian Lillard", pos:"PG" },
        { name:"CJ McCollum", pos:"SG" },
        { name:"Wesley Matthews", pos:"SG" },
        { name:"Nicolas Batum", pos:"SF" },
        { name:"Al-Farouq Aminu", pos:"SF" },
        { name:"LaMarcus Aldridge", pos:"PF" },
        { name:"Maurice Harkless", pos:"PF" },
        { name:"Robin Lopez", pos:"C" },
        { name:"Jusuf Nurkić", pos:"C" }
      ],
      "Utah": [
        { name:"Ricky Rubio", pos:"PG" },
        { name:"Trey Burke", pos:"PG" },
        { name:"Donovan Mitchell", pos:"SG" },
        { name:"Alec Burks", pos:"SG" },
        { name:"Gordon Hayward", pos:"SF" },
        { name:"Joe Ingles", pos:"SF" },
        { name:"Derrick Favors", pos:"PF" },
        { name:"Paul Millsap", pos:"PF" },
        { name:"Rudy Gobert", pos:"C" },
        { name:"Enes Kanter", pos:"C" }
      ],
      // Pacific Division — 2010s
      "Los Angeles L": [
        { name:"Kobe Bryant", pos:"SG" },
        { name:"D'Angelo Russell", pos:"PG" },
        { name:"Steve Nash", pos:"PG" },
        { name:"Jordan Clarkson", pos:"SG" },
        { name:"Nick Young", pos:"SG" },
        { name:"Brandon Ingram", pos:"SF" },
        { name:"Julius Randle", pos:"PF" },
        { name:"Pau Gasol", pos:"PF" },
        { name:"Dwight Howard", pos:"C" },
        { name:"LeBron James", pos:"SF" }
      ],
      "Los Angeles C": [
        { name:"Chris Paul", pos:"PG" },
        { name:"Austin Rivers", pos:"SG" },
        { name:"J.J. Redick", pos:"SG" },
        { name:"Jamal Crawford", pos:"SG" },
        { name:"Paul Pierce", pos:"SF" },
        { name:"Danilo Gallinari", pos:"PF" },
        { name:"Blake Griffin", pos:"PF" },
        { name:"DeAndre Jordan", pos:"C" }
      ],
      "Golden State": [
        { name:"Stephen Curry", pos:"PG" },
        { name:"Klay Thompson", pos:"SG" },
        { name:"Andre Iguodala", pos:"SF" },
        { name:"Harrison Barnes", pos:"SF" },
        { name:"Draymond Green", pos:"PF" },
        { name:"Kevin Durant", pos:"SF" },
        { name:"Andrew Bogut", pos:"C" }
      ],
      "Phoenix": [
        { name:"Steve Nash", pos:"PG" },
        { name:"Goran Dragic", pos:"PG" },
        { name:"Eric Bledsoe", pos:"PG" },
        { name:"Devin Booker", pos:"SG" },
        { name:"P.J. Tucker", pos:"SF" },
        { name:"Markieff Morris", pos:"PF" },
        { name:"Channing Frye", pos:"C" }
      ],
      "Sacramento": [
        { name:"Isaiah Thomas", pos:"PG" },
        { name:"Tyreke Evans", pos:"SG" },
        { name:"Ben McLemore", pos:"SG" },
        { name:"Rudy Gay", pos:"SF" },
        { name:"DeMarcus Cousins", pos:"C" }
      ],
      // Southwest Division — 2010s
      "Dallas": [
        { name:"Jason Kidd", pos:"PG" },
        { name:"J.J. Barea", pos:"PG" },
        { name:"Jason Terry", pos:"SG" },
        { name:"DeShawn Stevenson", pos:"SG" },
        { name:"Shawn Marion", pos:"SF" },
        { name:"Dirk Nowitzki", pos:"PF" },
        { name:"Tyson Chandler", pos:"C" }
      ],
      "Houston": [
        { name:"Chris Paul", pos:"PG" },
        { name:"James Harden", pos:"SG" },
        { name:"Eric Gordon", pos:"SG" },
        { name:"Trevor Ariza", pos:"SF" },
        { name:"P.J. Tucker", pos:"PF" },
        { name:"Ryan Anderson", pos:"PF" },
        { name:"Clint Capela", pos:"C" }
      ],
      "San Antonio": [
        { name:"Tony Parker", pos:"PG" },
        { name:"Manu Ginóbili", pos:"SG" },
        { name:"Danny Green", pos:"SG" },
        { name:"Kawhi Leonard", pos:"SF" },
        { name:"Tim Duncan", pos:"PF" },
        { name:"Boris Diaw", pos:"PF" },
        { name:"Tiago Splitter", pos:"C" }
      ],
      "Memphis": [
        { name:"Mike Conley", pos:"PG" },
        { name:"Jerryd Bayless", pos:"PG" },
        { name:"Tony Allen", pos:"SG" },
        { name:"Tayshaun Prince", pos:"SF" },
        { name:"Zach Randolph", pos:"PF" },
        { name:"Darrell Arthur", pos:"PF" },
        { name:"Marc Gasol", pos:"C" }
      ],
      "New Orleans": [
        { name:"Rajon Rondo", pos:"PG" },
        { name:"Jrue Holiday", pos:"SG" },
        { name:"E'Twaun Moore", pos:"SF" },
        { name:"Darius Miller", pos:"SF" },
        { name:"Anthony Davis", pos:"PF" },
        { name:"Nikola Mirotić", pos:"PF" },
        { name:"DeMarcus Cousins", pos:"C" }
      ],
      "Chicago": [
        { name:"Derrick Rose", pos:"PG" },
        { name:"Kyle Korver", pos:"SG" },
        { name:"Luol Deng", pos:"SF" },
        { name:"Carlos Boozer", pos:"PF" },
        { name:"Taj Gibson", pos:"PF" },
        { name:"Joakim Noah", pos:"C" }
      ],
      "Cleveland": [
        { name:"Kyrie Irving", pos:"PG" },
        { name:"J.R. Smith", pos:"SG" },
        { name:"LeBron James", pos:"SF" },
        { name:"Kevin Love", pos:"PF" },
        { name:"Tristan Thompson", pos:"C" }
      ],
      "Detroit": [
        { name:"Reggie Jackson", pos:"PG" },
        { name:"Kentavious Caldwell-Pope", pos:"SG" },
        { name:"Tobias Harris", pos:"SF" },
        { name:"Marcus Morris", pos:"PF" },
        { name:"Andre Drummond", pos:"C" }
      ],
      "Indiana": [
        { name:"George Hill", pos:"PG" },
        { name:"Lance Stephenson", pos:"SG" },
        { name:"Paul George", pos:"SF" },
        { name:"David West", pos:"PF" },
        { name:"Roy Hibbert", pos:"C" }
      ],
      "Milwaukee": [
        { name:"Eric Bledsoe", pos:"PG" },
        { name:"Khris Middleton", pos:"SG" },
        { name:"Giannis Antetokounmpo", pos:"SF" },
        { name:"Brook Lopez", pos:"C" }
      ]
    },
    "2020s": {
      "Boston": [
        { name:"Jrue Holiday", pos:"PG" },
        { name:"Derrick White", pos:"SG" },
        { name:"Jaylen Brown", pos:"SF" },
        { name:"Jayson Tatum", pos:"PF" },
        { name:"Kristaps Porziņģis", pos:"C" }
      ],
      "Brooklyn": [
        { name:"Kyrie Irving", pos:"PG" },
        { name:"James Harden", pos:"SG" },
        { name:"Kevin Durant", pos:"SF" },
        { name:"Blake Griffin", pos:"PF" },
        { name:"LaMarcus Aldridge", pos:"C" }
      ],
      "New York": [
        { name:"Jalen Brunson", pos:"PG" },
        { name:"Josh Hart", pos:"SG" },
        { name:"OG Anunoby", pos:"SF" },
        { name:"Julius Randle", pos:"PF" },
        { name:"Isaiah Hartenstein", pos:"C" }
      ],
      "Philadelphia": [
        { name:"James Harden", pos:"PG" },
        { name:"Tyrese Maxey", pos:"SG" },
        { name:"P.J. Tucker", pos:"SF" },
        { name:"Tobias Harris", pos:"PF" },
        { name:"Joel Embiid", pos:"C" }
      ],
      "Toronto": [
        { name:"Immanuel Quickley", pos:"PG" },
        { name:"Gary Trent Jr.", pos:"SG" },
        { name:"RJ Barrett", pos:"SF" },
        { name:"Scottie Barnes", pos:"PF" },
        { name:"Jakob Poeltl", pos:"C" }
      ],
      "Atlanta": [
        { name:"Trae Young", pos:"PG" },
        { name:"Bogdan Bogdanović", pos:"SG" },
        { name:"Kevin Huerter", pos:"SG" },
        { name:"John Collins", pos:"PF" },
        { name:"Clint Capela", pos:"C" }
      ],
      "Charlotte": [
        { name:"LaMelo Ball", pos:"PG" },
        { name:"Terry Rozier", pos:"SG" },
        { name:"Gordon Hayward", pos:"SF" },
        { name:"Miles Bridges", pos:"PF" },
        { name:"Mason Plumlee", pos:"C" }
      ],
      "Miami": [
        { name:"Kyle Lowry", pos:"PG" },
        { name:"Tyler Herro", pos:"SG" },
        { name:"Jimmy Butler", pos:"SF" },
        { name:"Kevin Love", pos:"PF" },
        { name:"Bam Adebayo", pos:"C" }
      ],
      "Orlando": [
        { name:"Jalen Suggs", pos:"PG" },
        { name:"Kentavious Caldwell-Pope", pos:"SG" },
        { name:"Franz Wagner", pos:"SF" },
        { name:"Paolo Banchero", pos:"PF" },
        { name:"Wendell Carter Jr.", pos:"C" }
      ],
      "Washington": [
        { name:"Russell Westbrook", pos:"PG" },
        { name:"Bradley Beal", pos:"SG" },
        { name:"Rui Hachimura", pos:"SF" },
        { name:"Davis Bertans", pos:"PF" },
        { name:"Thomas Bryant", pos:"C" }
      ],
      // Northwest Division — 2020s
      "Denver": [        { name:"Jamal Murray", pos:"PG" },
        { name:"Monte Morris", pos:"PG" },
        { name:"Kentavious Caldwell-Pope", pos:"SG" },
        { name:"Bones Hyland", pos:"SG" },
        { name:"Michael Porter Jr.", pos:"SF" },
        { name:"Bruce Brown", pos:"SF" },
        { name:"Aaron Gordon", pos:"PF" },
        { name:"Jeff Green", pos:"PF" },
        { name:"Nikola Jokić", pos:"C" }
      ],
      "Minnesota": [
        { name:"D'Angelo Russell", pos:"PG" },
        { name:"Mike Conley", pos:"PG" },
        { name:"Anthony Edwards", pos:"SG" },
        { name:"Jaylen Nowell", pos:"SG" },
        { name:"Jaden McDaniels", pos:"SF" },
        { name:"Kyle Anderson", pos:"SF" },
        { name:"Karl-Anthony Towns", pos:"PF" },
        { name:"Rudy Gobert", pos:"C" },
        { name:"Naz Reid", pos:"C" }
      ],
      "Oklahoma City": [
        { name:"Shai Gilgeous-Alexander", pos:"PG" },
        { name:"Josh Giddey", pos:"PG" },
        { name:"Luguentz Dort", pos:"SG" },
        { name:"Aaron Wiggins", pos:"SG" },
        { name:"Jalen Williams", pos:"SF" },
        { name:"Isaiah Joe", pos:"SF" },
        { name:"Jaylin Williams", pos:"PF" },
        { name:"Kenrich Williams", pos:"PF" },
        { name:"Chet Holmgren", pos:"C" },
        { name:"Isaiah Hartenstein", pos:"C" }
      ],
      "Portland": [
        { name:"Damian Lillard", pos:"PG" },
        { name:"Anfernee Simons", pos:"SG" },
        { name:"CJ McCollum", pos:"SG" },
        { name:"Jerami Grant", pos:"SF" },
        { name:"Nassir Little", pos:"SF" },
        { name:"Robert Covington", pos:"PF" },
        { name:"Jusuf Nurkić", pos:"C" },
        { name:"Deandre Ayton", pos:"C" }
      ],
      "Utah": [
        { name:"Mike Conley", pos:"PG" },
        { name:"Jordan Clarkson", pos:"PG" },
        { name:"Donovan Mitchell", pos:"SG" },
        { name:"Collin Sexton", pos:"SG" },
        { name:"Bojan Bogdanović", pos:"SF" },
        { name:"Lauri Markkanen", pos:"PF" },
        { name:"Rudy Gobert", pos:"C" },
        { name:"Walker Kessler", pos:"C" }
      ],
      // Pacific Division — 2020s
      "Los Angeles L": [
        { name:"LeBron James", pos:"SF" },
        { name:"Russell Westbrook", pos:"PG" },
        { name:"D'Angelo Russell", pos:"PG" },
        { name:"Dennis Schröder", pos:"PG" },
        { name:"Austin Reaves", pos:"SG" },
        { name:"Luka Dončić", pos:"PG" },
        { name:"Rui Hachimura", pos:"PF" },
        { name:"Jarred Vanderbilt", pos:"PF" },
        { name:"Anthony Davis", pos:"C" }
      ],
      "Los Angeles C": [
        { name:"Reggie Jackson", pos:"PG" },
        { name:"James Harden", pos:"PG" },
        { name:"Terance Mann", pos:"SG" },
        { name:"Paul George", pos:"SF" },
        { name:"Kawhi Leonard", pos:"SF" },
        { name:"Marcus Morris", pos:"PF" },
        { name:"Ivica Zubac", pos:"C" }
      ],
      "Golden State": [
        { name:"Stephen Curry", pos:"PG" },
        { name:"Klay Thompson", pos:"SG" },
        { name:"Jordan Poole", pos:"SG" },
        { name:"Andrew Wiggins", pos:"SF" },
        { name:"Draymond Green", pos:"PF" },
        { name:"Kevon Looney", pos:"C" }
      ],
      "Phoenix": [
        { name:"Chris Paul", pos:"PG" },
        { name:"Devin Booker", pos:"SG" },
        { name:"Mikal Bridges", pos:"SF" },
        { name:"Jae Crowder", pos:"PF" },
        { name:"Deandre Ayton", pos:"C" },
        { name:"Kevin Durant", pos:"SF" }
      ],
      "Sacramento": [
        { name:"De'Aaron Fox", pos:"PG" },
        { name:"Malik Monk", pos:"SG" },
        { name:"Kevin Huerter", pos:"SG" },
        { name:"Harrison Barnes", pos:"SF" },
        { name:"Domantas Sabonis", pos:"C" }
      ],
      // Southwest Division — 2020s
      "Dallas": [
        { name:"Luka Dončić", pos:"PG" },
        { name:"Kyrie Irving", pos:"SG" },
        { name:"Derrick Jones Jr.", pos:"SF" },
        { name:"Tim Hardaway Jr.", pos:"SF" },
        { name:"P.J. Washington", pos:"PF" },
        { name:"Daniel Gafford", pos:"C" },
        { name:"Dereck Lively II", pos:"C" }
      ],
      "Houston": [
        { name:"Fred VanVleet", pos:"PG" },
        { name:"Jalen Green", pos:"SG" },
        { name:"Dillon Brooks", pos:"SF" },
        { name:"Amen Thompson", pos:"SF" },
        { name:"Jabari Smith Jr.", pos:"PF" },
        { name:"Tari Eason", pos:"PF" },
        { name:"Alperen Şengün", pos:"C" }
      ],
      "San Antonio": [
        { name:"Tre Jones", pos:"PG" },
        { name:"Devin Vassell", pos:"SG" },
        { name:"Malaki Branham", pos:"SG" },
        { name:"Keldon Johnson", pos:"SF" },
        { name:"Jeremy Sochan", pos:"PF" },
        { name:"Zach Collins", pos:"PF" },
        { name:"Victor Wembanyama", pos:"C" }
      ],
      "Memphis": [
        { name:"Ja Morant", pos:"PG" },
        { name:"Tyus Jones", pos:"PG" },
        { name:"Desmond Bane", pos:"SG" },
        { name:"Dillon Brooks", pos:"SF" },
        { name:"Jaren Jackson Jr.", pos:"PF" },
        { name:"Brandon Clarke", pos:"PF" },
        { name:"Steven Adams", pos:"C" }
      ],
      "New Orleans": [
        { name:"Jose Alvarado", pos:"PG" },
        { name:"CJ McCollum", pos:"SG" },
        { name:"Brandon Ingram", pos:"SF" },
        { name:"Trey Murphy III", pos:"SF" },
        { name:"Zion Williamson", pos:"PF" },
        { name:"Herbert Jones", pos:"PF" },
        { name:"Jonas Valančiūnas", pos:"C" }
      ],
      "Chicago": [
        { name:"Lonzo Ball", pos:"PG" },
        { name:"Coby White", pos:"PG" },
        { name:"Zach LaVine", pos:"SG" },
        { name:"Ayo Dosunmu", pos:"SG" },
        { name:"DeMar DeRozan", pos:"SF" },
        { name:"Nikola Vučević", pos:"C" }
      ],
      "Cleveland": [
        { name:"Darius Garland", pos:"PG" },
        { name:"Donovan Mitchell", pos:"SG" },
        { name:"Caris LeVert", pos:"SF" },
        { name:"Evan Mobley", pos:"PF" },
        { name:"Jarrett Allen", pos:"C" }
      ],
      "Detroit": [
        { name:"Cade Cunningham", pos:"PG" },
        { name:"Jaden Ivey", pos:"SG" },
        { name:"Ausar Thompson", pos:"SF" },
        { name:"Tobias Harris", pos:"PF" },
        { name:"Jalen Duren", pos:"C" }
      ],
      "Indiana": [
        { name:"Tyrese Haliburton", pos:"PG" },
        { name:"Andrew Nembhard", pos:"SG" },
        { name:"Aaron Nesmith", pos:"SF" },
        { name:"Pascal Siakam", pos:"PF" },
        { name:"Myles Turner", pos:"C" }
      ],
      "Milwaukee": [
        { name:"Jrue Holiday", pos:"PG" },
        { name:"Khris Middleton", pos:"SG" },
        { name:"Giannis Antetokounmpo", pos:"SF" },
        { name:"Bobby Portis", pos:"PF" },
        { name:"Brook Lopez", pos:"C" }
      ]
    }
  };

  // Historical context for franchises that changed cities —
  // so the roster (drawn from the team's real history) isn't confusing out of context.
  var BBALL_NOTES = {
    "1970s|Oklahoma City": "Playing as the Seattle SuperSonics — the franchise didn't move to Oklahoma City until 2008.",
    "1980s|Oklahoma City": "Playing as the Seattle SuperSonics — the franchise didn't move to Oklahoma City until 2008.",
    "1990s|Oklahoma City": "Playing as the Seattle SuperSonics — the franchise didn't move to Oklahoma City until 2008.",
    "2000s|Oklahoma City": "Playing as the Seattle SuperSonics — the franchise didn't move to Oklahoma City until 2008.",
    "1970s|Utah": "Playing as the New Orleans Jazz — the franchise didn't move to Salt Lake City until 1979.",
    "1970s|Los Angeles C": "Playing as the Buffalo Braves — the franchise didn't move to San Diego until 1978, or to Los Angeles until 1984.",
    "1980s|Los Angeles C": "Playing as the San Diego Clippers for the first half of the decade — the franchise didn't move to Los Angeles until 1984.",
    "1970s|Sacramento": "Playing as the Kansas City-Omaha Kings / Kansas City Kings — the franchise didn't move to Sacramento until 1985.",
    "1980s|Sacramento": "Playing as the Kansas City Kings for the first half of the decade — the franchise didn't move to Sacramento until 1985.",
    "1990s|Memphis": "Playing as the Vancouver Grizzlies — the franchise didn't move to Memphis until 2001.",
    "2000s|Charlotte": "Playing as the Charlotte Bobcats — the original Hornets had relocated to New Orleans in 2002; this expansion team didn't take the Hornets name back until 2014."
  };

  // Per-player stats — the SINGLE regular season within that specific decade+team window
  // where the player's PPG was highest, with the RPG/APG that came from that exact same
  // season (not independently-best RPG/APG from a different year). This is a genuinely
  // small, hand-verified starter set pulled from real season-by-season tables — most
  // players in the roster data don't have an entry yet, and the eligible list simply
  // omits the stats line for those rather than guessing.
  // Keyed "PlayerName|Team|Era".
  var BBALL_STATS = {
    // Boston Celtics — 1970s (from the 1973-74 56-26 NBA championship team)
    "John Havlicek|Boston|1970s": { ppg:22.6, rpg:6.4, apg:5.9, season:"1973-74" },
    "Dave Cowens|Boston|1970s": { ppg:19.0, rpg:15.7, apg:4.4, season:"1973-74" },
    "Jo Jo White|Boston|1970s": { ppg:18.1, rpg:4.3, apg:5.5, season:"1973-74" },
    "Paul Silas|Boston|1970s": { ppg:11.5, rpg:11.2, apg:2.3, season:"1973-74" },
    "Don Nelson|Boston|1970s": { ppg:11.5, rpg:4.2, apg:2.0, season:"1973-74" },
    "Don Chaney|Boston|1970s": { ppg:10.4, rpg:4.7, apg:2.2, season:"1973-74" },
    "Paul Westphal|Boston|1970s": { ppg:7.2, rpg:1.7, apg:2.1, season:"1973-74" },

    // Brooklyn Nets — 1970s (from the 1973-74 55-29 ABA championship team, Dr. J's MVP season)
    "Julius Erving|Brooklyn|1970s": { ppg:27.4, rpg:10.7, apg:4.0, season:"1973-74" },
    "Larry Kenon|Brooklyn|1970s": { ppg:19.5, rpg:9.0, apg:2.5, season:"1973-74" },
    "Billy Paultz|Brooklyn|1970s": { ppg:15.0, rpg:9.5, apg:2.0, season:"1973-74" },
    "Brian Taylor|Brooklyn|1970s": { ppg:11.9, rpg:3.0, apg:4.5, season:"1973-74" },
    "John Williamson|Brooklyn|1970s": { ppg:9.7, rpg:2.5, apg:1.5, season:"1973-74" },

    // New York Knicks — 1970s (from the 1972-73 57-25 NBA championship team, all 5 starters Hall of Famers)
    "Walt Frazier|New York|1970s": { ppg:21.1, rpg:7.3, apg:5.9, season:"1972-73" },
    "Dave DeBusschere|New York|1970s": { ppg:16.3, rpg:10.2, apg:3.4, season:"1972-73" },
    "Bill Bradley|New York|1970s": { ppg:16.1, rpg:3.7, apg:4.5, season:"1972-73" },
    "Earl Monroe|New York|1970s": { ppg:15.5, rpg:3.3, apg:3.8, season:"1972-73" },
    "Willis Reed|New York|1970s": { ppg:11.0, rpg:8.6, apg:1.8, season:"1972-73" },

    // Philadelphia 76ers — 1970s (from the 1976-77 50-32 team, Dr. J's first season with the Sixers, NBA Finals run)
    "Julius Erving|Philadelphia|1970s": { ppg:21.6, rpg:8.5, apg:3.7, season:"1976-77" },
    "George McGinnis|Philadelphia|1970s": { ppg:21.4, rpg:11.0, apg:4.0, season:"1976-77" },
    "Doug Collins|Philadelphia|1970s": { ppg:18.3, rpg:3.5, apg:3.0, season:"1976-77" },
    "World B. Free|Philadelphia|1970s": { ppg:16.3, rpg:3.0, apg:2.5, season:"1976-77" },
    "Henry Bibby|Philadelphia|1970s": { ppg:10.2, rpg:2.5, apg:6.0, season:"1976-77" },
    "Caldwell Jones|Philadelphia|1970s": { ppg:8.0, rpg:8.1, apg:1.5, season:"1976-77" },
    "Alex English|Denver|1980s": { ppg:29.8, rpg:5.0, apg:4.0, season:"1985-86" },
    "Dikembe Mutombo|Denver|1990s": { ppg:16.6, rpg:12.3, apg:2.2, season:"1991-92" },
    "John Stockton|Utah|1980s": { ppg:17.2, rpg:2.6, apg:14.5, season:"1989-90" },
    "John Stockton|Utah|1990s": { ppg:17.2, rpg:2.9, apg:14.2, season:"1990-91" },

    // Boston Celtics — 1980s, from the 1985-86 67-15 championship team (arguably the greatest Celtics team ever)
    "Larry Bird|Boston|1980s": { ppg:25.8, rpg:9.8, apg:6.8, season:"1985-86" },
    "Kevin McHale|Boston|1980s": { ppg:26.1, rpg:9.9, apg:2.7, season:"1985-86" },
    "Robert Parish|Boston|1980s": { ppg:16.1, rpg:9.5, apg:1.8, season:"1985-86" },
    "Danny Ainge|Boston|1980s": { ppg:10.7, rpg:2.9, apg:5.1, season:"1985-86" },
    "Bill Walton|Boston|1980s": { ppg:7.6, rpg:6.8, apg:2.1, season:"1985-86" },
    "Scott Wedman|Boston|1980s": { ppg:9.6, rpg:3.7, apg:1.6, season:"1985-86" },
    "Jerry Sichting|Boston|1980s": { ppg:6.8, rpg:1.2, apg:2.4, season:"1985-86" },
    "Greg Kite|Boston|1980s": { ppg:2.5, rpg:2.8, apg:0.3, season:"1985-86" },

    // Boston Celtics — 1980s, from the 1980-81 62-20 championship team (Bird's first title, Maxwell's Finals MVP)
    "Cedric Maxwell|Boston|1980s": { ppg:15.4, rpg:7.0, apg:2.2, season:"1980-81" },
    "Nate Archibald|Boston|1980s": { ppg:13.8, rpg:2.3, apg:7.7, season:"1980-81" },
    "Rick Robey|Boston|1980s": { ppg:9.3, rpg:5.5, apg:1.5, season:"1980-81" },
    "Chris Ford|Boston|1980s": { ppg:9.2, rpg:2.5, apg:3.0, season:"1980-81" },

    // Boston Celtics — 1980s, from the 1983-84 62-20 championship team (Bird's regular season and Finals MVP)
    "Dennis Johnson|Boston|1980s": { ppg:13.2, rpg:3.5, apg:5.1, season:"1983-84" },
    "Gerald Henderson|Boston|1980s": { ppg:11.6, rpg:2.3, apg:4.3, season:"1983-84" },

    // Brooklyn Nets — 1980s (from the 1983-84 45-37 team, franchise's first playoff series win)
    "Buck Williams|Brooklyn|1980s": { ppg:13.8, rpg:14.1, apg:1.7, season:"1983-84" },
    "Otis Birdsong|Brooklyn|1980s": { ppg:19.8, rpg:3.5, apg:2.9, season:"1983-84" },
    "Darryl Dawkins|Brooklyn|1980s": { ppg:16.8, rpg:6.7, apg:1.2, season:"1983-84" },
    "Micheal Ray Richardson|Brooklyn|1980s": { ppg:14.6, rpg:5.1, apg:7.2, season:"1983-84" },
    "Albert King|Brooklyn|1980s": { ppg:15.3, rpg:4.5, apg:2.0, season:"1983-84" },

    // New York Knicks — 1980s (from the 1984-85 24-58 team, King's real league-leading scoring title season)
    "Bernard King|New York|1980s": { ppg:32.9, rpg:5.0, apg:3.0, season:"1984-85" },
    "Pat Cummings|New York|1980s": { ppg:15.8, rpg:7.4, apg:1.5, season:"1984-85" },

    // Philadelphia 76ers — 1980s (from the 1982-83 65-17 "Fo, Fi, Fo" NBA championship team)
    "Moses Malone|Philadelphia|1980s": { ppg:24.5, rpg:15.3, apg:1.5, season:"1982-83" },
    "Julius Erving|Philadelphia|1980s": { ppg:21.4, rpg:6.8, apg:3.7, season:"1982-83" },
    "Andrew Toney|Philadelphia|1980s": { ppg:19.7, rpg:2.9, apg:4.0, season:"1982-83" },
    "Maurice Cheeks|Philadelphia|1980s": { ppg:12.5, rpg:3.4, apg:6.9, season:"1982-83" },
    "Bobby Jones|Philadelphia|1980s": { ppg:9.0, rpg:5.1, apg:2.4, season:"1982-83" },
    "Rory Sparrow|New York|1980s": { ppg:12.0, rpg:2.5, apg:6.8, season:"1984-85" },
    "Louis Orr|New York|1980s": { ppg:12.7, rpg:5.0, apg:1.5, season:"1984-85" },
    "Trent Tucker|New York|1980s": { ppg:11.0, rpg:2.0, apg:2.5, season:"1984-85" },

    // Brooklyn Nets — 1990s (from the 1997-98 43-39 team)
    "Sam Cassell|Brooklyn|1990s": { ppg:17.9, rpg:2.5, apg:7.4, season:"1997-98" },
    "Kerry Kittles|Brooklyn|1990s": { ppg:16.0, rpg:3.9, apg:2.6, season:"1997-98" },
    "Keith Van Horn|Brooklyn|1990s": { ppg:16.0, rpg:6.5, apg:2.0, season:"1997-98" },
    "Kendall Gill|Brooklyn|1990s": { ppg:13.0, rpg:4.0, apg:2.5, season:"1997-98" },
    "Jayson Williams|Brooklyn|1990s": { ppg:12.9, rpg:13.5, apg:1.5, season:"1997-98" },

    // New York Knicks — 1990s (from the 1993-94 57-25 team, franchise's first Finals since 1973)
    "Patrick Ewing|New York|1990s": { ppg:24.5, rpg:11.2, apg:2.0, season:"1993-94" },
    "John Starks|New York|1990s": { ppg:19.0, rpg:3.5, apg:5.9, season:"1993-94" },
    "Charles Oakley|New York|1990s": { ppg:9.4, rpg:11.8, apg:2.4, season:"1993-94" },
    "Anthony Mason|New York|1990s": { ppg:10.0, rpg:6.0, apg:3.0, season:"1993-94" },
    "Derek Harper|New York|1990s": { ppg:11.5, rpg:2.5, apg:4.5, season:"1993-94" },

    // Philadelphia 76ers — 1990s (from the 1996-97 22-60 team, Iverson's real Rookie of the Year season)
    "Allen Iverson|Philadelphia|1990s": { ppg:23.5, rpg:4.1, apg:7.5, season:"1996-97" },
    "Jerry Stackhouse|Philadelphia|1990s": { ppg:20.7, rpg:4.0, apg:3.0, season:"1996-97" },
    "Clarence Weatherspoon|Philadelphia|1990s": { ppg:15.3, rpg:8.3, apg:1.8, season:"1996-97" },
    "Derrick Coleman|Philadelphia|1990s": { ppg:14.0, rpg:8.0, apg:2.5, season:"1996-97" },
    "Michael Cage|Philadelphia|1990s": { ppg:5.0, rpg:6.0, apg:0.8, season:"1996-97" },

    // Toronto Raptors — 1990s (from the 1995-96 21-61 inaugural expansion team, Stoudamire's real Rookie of the Year season)
    "Damon Stoudamire|Toronto|1990s": { ppg:19.0, rpg:4.0, apg:9.3, season:"1995-96" },
    "Tracy Murray|Toronto|1990s": { ppg:16.2, rpg:4.3, apg:1.2, season:"1995-96" },
    "Oliver Miller|Toronto|1990s": { ppg:12.9, rpg:7.4, apg:2.5, season:"1995-96" },
    "Doug Christie|Toronto|1990s": { ppg:10.1, rpg:3.8, apg:2.5, season:"1995-96" },
    "Tony Massenburg|Toronto|1990s": { ppg:9.0, rpg:5.5, apg:1.0, season:"1995-96" },

    // Brooklyn Nets — 2000s (from the 2002-03 49-33 team, franchise's second straight NBA Finals)
    "Jason Kidd|Brooklyn|2000s": { ppg:18.7, rpg:6.3, apg:8.9, season:"2002-03" },
    "Kenyon Martin|Brooklyn|2000s": { ppg:16.7, rpg:8.3, apg:1.6, season:"2002-03" },
    "Richard Jefferson|Brooklyn|2000s": { ppg:15.5, rpg:6.4, apg:2.2, season:"2002-03" },
    "Kerry Kittles|Brooklyn|2000s": { ppg:12.0, rpg:3.5, apg:2.5, season:"2002-03" },
    "Jason Collins|Brooklyn|2000s": { ppg:5.1, rpg:5.5, apg:1.0, season:"2002-03" },

    // New York Knicks — 2000s (from the 2000-01 48-34 team, Larry Johnson's final season, post-Ewing-trade)
    "Allan Houston|New York|2000s": { ppg:20.5, rpg:3.5, apg:3.0, season:"2000-01" },
    "Latrell Sprewell|New York|2000s": { ppg:18.6, rpg:4.2, apg:4.0, season:"2000-01" },
    "Marcus Camby|New York|2000s": { ppg:11.9, rpg:9.9, apg:1.5, season:"2000-01" },
    "Larry Johnson|New York|2000s": { ppg:9.0, rpg:5.0, apg:2.0, season:"2000-01" },
    "Charlie Ward|New York|2000s": { ppg:6.8, rpg:3.0, apg:4.8, season:"2000-01" },

    // Philadelphia 76ers — 2000s (from the 2000-01 56-26 team, Iverson's real MVP season, franchise's last Finals trip)
    "Allen Iverson|Philadelphia|2000s": { ppg:31.1, rpg:3.8, apg:4.6, season:"2000-01" },
    "Dikembe Mutombo|Philadelphia|2000s": { ppg:11.7, rpg:12.0, apg:1.5, season:"2000-01" },
    "Aaron McKie|Philadelphia|2000s": { ppg:11.6, rpg:4.5, apg:4.6, season:"2000-01" },
    "Eric Snow|Philadelphia|2000s": { ppg:10.0, rpg:3.0, apg:6.9, season:"2000-01" },
    "Tyrone Hill|Philadelphia|2000s": { ppg:7.0, rpg:6.5, apg:1.0, season:"2000-01" },

    // Toronto Raptors — 2000s (from the 1999-2000 45-37 team, franchise's first-ever playoff appearance)
    "Vince Carter|Toronto|2000s": { ppg:25.7, rpg:5.8, apg:3.9, season:"1999-2000" },
    "Tracy McGrady|Toronto|2000s": { ppg:15.4, rpg:6.3, apg:3.0, season:"1999-2000" },
    "Doug Christie|Toronto|2000s": { ppg:12.4, rpg:4.0, apg:4.4, season:"1999-2000" },
    "Antonio Davis|Toronto|2000s": { ppg:11.5, rpg:8.8, apg:1.3, season:"1999-2000" },
    "Charles Oakley|Toronto|2000s": { ppg:6.8, rpg:6.9, apg:1.5, season:"1999-2000" },

    // Brooklyn Nets — 2010s (from the 2013-14 44-38 team, "35 combined All-Star appearances" starting five)
    "Joe Johnson|Brooklyn|2010s": { ppg:21.2, rpg:3.6, apg:3.7, season:"2013-14" },
    "Brook Lopez|Brooklyn|2010s": { ppg:17.2, rpg:7.0, apg:1.5, season:"2013-14" },
    "Deron Williams|Brooklyn|2010s": { ppg:14.3, rpg:2.7, apg:5.8, season:"2013-14" },
    "Paul Pierce|Brooklyn|2010s": { ppg:13.5, rpg:4.6, apg:2.5, season:"2013-14" },
    "Kevin Garnett|Brooklyn|2010s": { ppg:6.5, rpg:6.3, apg:1.5, season:"2013-14" },

    // New York Knicks — 2010s (from the 2012-13 54-28 team, franchise's best record since 1993-94)
    "Carmelo Anthony|New York|2010s": { ppg:28.7, rpg:6.9, apg:2.6, season:"2012-13" },
    "J.R. Smith|New York|2010s": { ppg:18.1, rpg:5.3, apg:2.0, season:"2012-13" },
    "Raymond Felton|New York|2010s": { ppg:13.9, rpg:3.6, apg:5.5, season:"2012-13" },
    "Tyson Chandler|New York|2010s": { ppg:10.4, rpg:10.7, apg:0.9, season:"2012-13" },
    "Jason Kidd|New York|2010s": { ppg:6.0, rpg:3.0, apg:3.1, season:"2012-13" },

    // Philadelphia 76ers — 2010s (from the 2018-19 51-31 team, the "Process" era's stacked playoff roster)
    "Joel Embiid|Philadelphia|2010s": { ppg:27.5, rpg:13.6, apg:3.7, season:"2018-19" },
    "Jimmy Butler|Philadelphia|2010s": { ppg:18.2, rpg:5.3, apg:3.9, season:"2018-19" },
    "JJ Redick|Philadelphia|2010s": { ppg:18.1, rpg:2.4, apg:2.4, season:"2018-19" },
    "Tobias Harris|Philadelphia|2010s": { ppg:18.2, rpg:7.9, apg:2.8, season:"2018-19" },
    "Ben Simmons|Philadelphia|2010s": { ppg:16.9, rpg:8.8, apg:7.7, season:"2018-19" },

    // Toronto Raptors — 2010s (from the 2018-19 58-24 team, franchise's first-ever NBA championship)
    "Kawhi Leonard|Toronto|2010s": { ppg:26.6, rpg:7.3, apg:3.3, season:"2018-19" },
    "Pascal Siakam|Toronto|2010s": { ppg:16.9, rpg:6.9, apg:2.2, season:"2018-19" },
    "Kyle Lowry|Toronto|2010s": { ppg:14.2, rpg:4.8, apg:8.7, season:"2018-19" },
    "Marc Gasol|Toronto|2010s": { ppg:9.8, rpg:7.0, apg:3.6, season:"2018-19" },
    "Danny Green|Toronto|2010s": { ppg:10.3, rpg:3.1, apg:1.5, season:"2018-19" },

    // New York Knicks — 2020s (from the 2023-24 50-32 team, Brunson's real career-high scoring season)
    "Jalen Brunson|New York|2020s": { ppg:28.7, rpg:3.6, apg:6.7, season:"2023-24" },
    "Julius Randle|New York|2020s": { ppg:24.0, rpg:9.2, apg:5.0, season:"2023-24" },
    "OG Anunoby|New York|2020s": { ppg:14.1, rpg:4.0, apg:1.9, season:"2023-24" },
    "Josh Hart|New York|2020s": { ppg:9.5, rpg:8.3, apg:4.1, season:"2023-24" },
    "Isaiah Hartenstein|New York|2020s": { ppg:7.8, rpg:8.3, apg:2.5, season:"2023-24" },

    // Philadelphia 76ers — 2020s (from the 2022-23 54-28 team, Embiid's real MVP season)
    "Joel Embiid|Philadelphia|2020s": { ppg:33.1, rpg:10.2, apg:4.2, season:"2022-23" },
    "James Harden|Philadelphia|2020s": { ppg:21.0, rpg:6.1, apg:10.7, season:"2022-23" },
    "Tyrese Maxey|Philadelphia|2020s": { ppg:20.3, rpg:3.5, apg:3.5, season:"2022-23" },
    "Tobias Harris|Philadelphia|2020s": { ppg:17.2, rpg:6.5, apg:3.0, season:"2022-23" },
    "P.J. Tucker|Philadelphia|2020s": { ppg:4.6, rpg:4.6, apg:1.2, season:"2022-23" },

    // Toronto Raptors — 2020s (from the 2023-24 25-57 rebuild team, Barnes' real career-best season)
    "Scottie Barnes|Toronto|2020s": { ppg:19.9, rpg:8.2, apg:6.1, season:"2023-24" },
    "RJ Barrett|Toronto|2020s": { ppg:18.9, rpg:5.3, apg:3.1, season:"2023-24" },
    "Immanuel Quickley|Toronto|2020s": { ppg:18.6, rpg:4.2, apg:6.8, season:"2023-24" },
    "Gary Trent Jr.|Toronto|2020s": { ppg:18.3, rpg:2.8, apg:2.1, season:"2023-24" },
    "Jakob Poeltl|Toronto|2020s": { ppg:9.9, rpg:9.4, apg:2.2, season:"2023-24" },

    // Brooklyn Nets — 2020s (from the 2020-21 48-24 team, Durant/Irving/Harden "Big 3" era)
    "Kevin Durant|Brooklyn|2020s": { ppg:26.9, rpg:7.1, apg:5.6, season:"2020-21" },
    "Kyrie Irving|Brooklyn|2020s": { ppg:26.9, rpg:5.2, apg:6.0, season:"2020-21" },
    "James Harden|Brooklyn|2020s": { ppg:24.6, rpg:8.5, apg:10.9, season:"2020-21" },
    "LaMarcus Aldridge|Brooklyn|2020s": { ppg:12.9, rpg:5.5, apg:1.0, season:"2020-21" },
    "Blake Griffin|Brooklyn|2020s": { ppg:6.6, rpg:3.5, apg:2.6, season:"2020-21" },

    // Boston Celtics — 1990s (from the 1990-91 56-26 team, Bird's last great season)
    "Larry Bird|Boston|1990s": { ppg:19.4, rpg:8.5, apg:7.2, season:"1990-91" },
    "Reggie Lewis|Boston|1990s": { ppg:18.7, rpg:4.0, apg:2.9, season:"1990-91" },
    "Kevin McHale|Boston|1990s": { ppg:18.4, rpg:7.1, apg:1.7, season:"1990-91" },
    "Robert Parish|Boston|1990s": { ppg:14.0, rpg:10.6, apg:1.8, season:"1990-91" },
    "Dee Brown|Boston|1990s": { ppg:12.1, rpg:2.6, apg:4.2, season:"1990-91" },

    // Boston Celtics — 2000s (from the 2007-08 66-16 NBA championship team, "Big Three" debut)
    "Paul Pierce|Boston|2000s": { ppg:19.6, rpg:5.1, apg:4.5, season:"2007-08" },
    "Kevin Garnett|Boston|2000s": { ppg:18.8, rpg:9.2, apg:3.4, season:"2007-08" },
    "Ray Allen|Boston|2000s": { ppg:17.4, rpg:3.3, apg:3.1, season:"2007-08" },
    "Rajon Rondo|Boston|2000s": { ppg:6.4, rpg:3.7, apg:5.1, season:"2007-08" },
    "Kendrick Perkins|Boston|2000s": { ppg:6.9, rpg:6.1, apg:0.8, season:"2007-08" },

    // Boston Celtics — 2010s (from the 2017-18 55-27 team, Eastern Conference Finals run without Irving/Hayward)
    "Kyrie Irving|Boston|2010s": { ppg:24.4, rpg:3.8, apg:5.1, season:"2017-18" },
    "Jaylen Brown|Boston|2010s": { ppg:14.5, rpg:4.9, apg:1.6, season:"2017-18" },
    "Jayson Tatum|Boston|2010s": { ppg:13.9, rpg:5.0, apg:1.6, season:"2017-18" },
    "Al Horford|Boston|2010s": { ppg:12.9, rpg:7.4, apg:4.7, season:"2017-18" },
    "Terry Rozier|Boston|2010s": { ppg:8.5, rpg:3.4, apg:2.7, season:"2017-18" },
    "Marcus Morris|Boston|2010s": { ppg:13.4, rpg:4.6, apg:1.4, season:"2017-18" },

    // Boston Celtics — 2020s (from the 2023-24 64-18 NBA championship team, franchise's 18th title)
    "Jayson Tatum|Boston|2020s": { ppg:26.9, rpg:8.1, apg:4.9, season:"2023-24" },
    "Jaylen Brown|Boston|2020s": { ppg:23.0, rpg:5.5, apg:3.6, season:"2023-24" },
    "Kristaps Porziņģis|Boston|2020s": { ppg:20.1, rpg:7.2, apg:2.0, season:"2023-24" },
    "Derrick White|Boston|2020s": { ppg:15.2, rpg:4.2, apg:5.2, season:"2023-24" },
    "Jrue Holiday|Boston|2020s": { ppg:12.5, rpg:5.4, apg:4.8, season:"2023-24" },

    // Atlanta Hawks — 1980s (from the 1985-86 50-32 team)
    "Dominique Wilkins|Atlanta|1980s": { ppg:30.3, rpg:7.9, apg:2.6, season:"1985-86" },
    "Kevin Willis|Atlanta|1980s": { ppg:12.3, rpg:8.6, apg:0.8, season:"1985-86" },
    "Randy Wittman|Atlanta|1980s": { ppg:12.9, rpg:2.6, apg:3.8, season:"1985-86" },
    "Doc Rivers|Atlanta|1980s": { ppg:11.5, rpg:3.7, apg:3.8, season:"1985-86" },
    "Tree Rollins|Atlanta|1980s": { ppg:7.4, rpg:8.8, apg:1.4, season:"1985-86" },
    "Cliff Levingston|Atlanta|1980s": { ppg:9.7, rpg:6.5, apg:1.4, season:"1985-86" },
    "Spud Webb|Atlanta|1980s": { ppg:6.1, rpg:1.8, apg:3.2, season:"1985-86" },

    // Charlotte Hornets — 1980s (from the 1988-89 inaugural expansion team)
    "Kelly Tripucka|Charlotte|1980s": { ppg:22.6, rpg:3.8, apg:2.8, season:"1988-89" },
    "Rex Chapman|Charlotte|1980s": { ppg:16.9, rpg:2.5, apg:2.1, season:"1988-89" },
    "Robert Reid|Charlotte|1980s": { ppg:14.7, rpg:4.0, apg:2.5, season:"1988-89" },
    "Kurt Rambis|Charlotte|1980s": { ppg:11.1, rpg:8.6, apg:1.8, season:"1988-89" },
    "Muggsy Bogues|Charlotte|1980s": { ppg:7.4, rpg:2.3, apg:7.6, season:"1988-89" },
    "Earl Cureton|Charlotte|1980s": { ppg:6.5, rpg:5.0, apg:1.0, season:"1988-89" },

    // Miami Heat — 1980s (from the 1989-90 team, Seikaly's real Most Improved Player season)
    "Rony Seikaly|Miami|1980s": { ppg:16.6, rpg:10.4, apg:1.3, season:"1989-90" },
    "Sherman Douglas|Miami|1980s": { ppg:14.3, rpg:2.5, apg:7.6, season:"1989-90" },
    "Glen Rice|Miami|1980s": { ppg:13.6, rpg:4.6, apg:1.5, season:"1989-90" },
    "Kevin Edwards|Miami|1980s": { ppg:12.0, rpg:2.7, apg:3.0, season:"1989-90" },
    "Billy Thompson|Miami|1980s": { ppg:11.0, rpg:7.0, apg:1.5, season:"1989-90" },
    "Tellis Frank|Miami|1980s": { ppg:9.5, rpg:5.0, apg:1.0, season:"1989-90" },
    "Grant Long|Miami|1980s": { ppg:8.5, rpg:5.0, apg:1.3, season:"1989-90" },

    // Orlando Magic — 1980s (from the 1989-90 inaugural expansion team)
    "Terry Catledge|Orlando|1980s": { ppg:18.0, rpg:7.0, apg:1.5, season:"1989-90" },
    "Reggie Theus|Orlando|1980s": { ppg:17.5, rpg:3.0, apg:5.0, season:"1989-90" },
    "Nick Anderson|Orlando|1980s": { ppg:13.0, rpg:5.0, apg:2.0, season:"1989-90" },
    "Scott Skiles|Orlando|1980s": { ppg:11.0, rpg:3.0, apg:7.5, season:"1989-90" },
    "Sidney Green|Orlando|1980s": { ppg:10.4, rpg:8.1, apg:3.2, season:"1989-90" },
    "Mark Acres|Orlando|1980s": { ppg:5.0, rpg:5.0, apg:0.5, season:"1989-90" },

    // Orlando Magic — 1990s (from the 1994-95 57-25 team, first-ever NBA Finals appearance)
    "Shaquille O'Neal|Orlando|1990s": { ppg:29.3, rpg:11.4, apg:2.7, season:"1994-95" },
    "Penny Hardaway|Orlando|1990s": { ppg:20.9, rpg:4.7, apg:7.2, season:"1994-95" },
    "Horace Grant|Orlando|1990s": { ppg:12.8, rpg:9.7, apg:3.1, season:"1994-95" },
    "Nick Anderson|Orlando|1990s": { ppg:15.8, rpg:4.5, apg:4.1, season:"1994-95" },
    "Dennis Scott|Orlando|1990s": { ppg:12.9, rpg:2.9, apg:2.2, season:"1994-95" },
    "Donald Royal|Orlando|1990s": { ppg:9.1, rpg:4.0, apg:1.3, season:"1994-95" },

    // Orlando Magic — 2000s (from the 2008-09 59-23 team, second-ever NBA Finals appearance)
    "Dwight Howard|Orlando|2000s": { ppg:20.6, rpg:13.8, apg:1.5, season:"2008-09" },
    "Rashard Lewis|Orlando|2000s": { ppg:18.9, rpg:6.0, apg:1.8, season:"2008-09" },
    "Hedo Türkoğlu|Orlando|2000s": { ppg:16.8, rpg:5.3, apg:4.8, season:"2008-09" },
    "Jameer Nelson|Orlando|2000s": { ppg:16.7, rpg:3.0, apg:5.4, season:"2008-09" },
    "Courtney Lee|Orlando|2000s": { ppg:8.9, rpg:2.7, apg:1.5, season:"2008-09" },

    // Orlando Magic — 2010s (from the 2018-19 42-40 team, first playoff berth since 2012)
    "Nikola Vučević|Orlando|2010s": { ppg:20.6, rpg:12.2, apg:3.8, season:"2018-19" },
    "Evan Fournier|Orlando|2010s": { ppg:17.8, rpg:2.9, apg:2.9, season:"2018-19" },
    "Aaron Gordon|Orlando|2010s": { ppg:16.1, rpg:7.4, apg:2.3, season:"2018-19" },
    "Terrence Ross|Orlando|2010s": { ppg:14.6, rpg:2.9, apg:1.5, season:"2018-19" },
    "D.J. Augustin|Orlando|2010s": { ppg:12.8, rpg:2.5, apg:5.3, season:"2018-19" },

    // Orlando Magic — 2020s (from the 2023-24 47-35 team, Banchero's real All-Star season)
    "Paolo Banchero|Orlando|2020s": { ppg:22.6, rpg:6.9, apg:5.4, season:"2023-24" },
    "Franz Wagner|Orlando|2020s": { ppg:19.7, rpg:4.3, apg:3.7, season:"2023-24" },
    "Jalen Suggs|Orlando|2020s": { ppg:12.6, rpg:3.9, apg:3.2, season:"2023-24" },
    "Wendell Carter Jr.|Orlando|2020s": { ppg:11.0, rpg:8.1, apg:2.4, season:"2023-24" },
    "Kentavious Caldwell-Pope|Orlando|2020s": { ppg:10.6, rpg:2.5, apg:1.8, season:"2023-24" },

    // Miami Heat — 1990s (from the 1996-97 61-21 franchise-record team, Riley's Eastern Conference Finals run)
    "Tim Hardaway|Miami|1990s": { ppg:20.3, rpg:3.4, apg:8.6, season:"1996-97" },
    "Alonzo Mourning|Miami|1990s": { ppg:19.8, rpg:9.9, apg:1.5, season:"1996-97" },
    "Voshon Lenard|Miami|1990s": { ppg:13.0, rpg:2.5, apg:1.5, season:"1996-97" },
    "P.J. Brown|Miami|1990s": { ppg:11.0, rpg:8.0, apg:2.0, season:"1996-97" },
    "Dan Majerle|Miami|1990s": { ppg:9.0, rpg:4.5, apg:3.0, season:"1996-97" },

    // Miami Heat — 2000s (from the 2005-06 52-30 NBA championship team)
    "Dwyane Wade|Miami|2000s": { ppg:27.2, rpg:5.7, apg:6.7, season:"2005-06" },
    "Shaquille O'Neal|Miami|2000s": { ppg:20.0, rpg:9.2, apg:2.5, season:"2005-06" },
    "Jason Williams|Miami|2000s": { ppg:12.3, rpg:2.5, apg:4.9, season:"2005-06" },
    "Antoine Walker|Miami|2000s": { ppg:12.0, rpg:6.0, apg:3.0, season:"2005-06" },
    "Udonis Haslem|Miami|2000s": { ppg:10.0, rpg:7.8, apg:1.5, season:"2005-06" },

    // Miami Heat — 2010s (from the 2012-13 66-16 NBA championship team, LeBron's real MVP season)
    "LeBron James|Miami|2010s": { ppg:26.8, rpg:8.0, apg:7.3, season:"2012-13" },
    "Dwyane Wade|Miami|2010s": { ppg:21.2, rpg:4.6, apg:5.1, season:"2012-13" },
    "Chris Bosh|Miami|2010s": { ppg:16.6, rpg:6.8, apg:1.8, season:"2012-13" },
    "Mario Chalmers|Miami|2010s": { ppg:9.8, rpg:3.1, apg:3.5, season:"2012-13" },
    "Chris Andersen|Miami|2010s": { ppg:4.7, rpg:4.0, apg:0.5, season:"2012-13" },

    // Miami Heat — 2020s (from the 2022-23 44-38 team that reached the NBA Finals as an 8-seed)
    "Jimmy Butler|Miami|2020s": { ppg:22.9, rpg:5.9, apg:5.3, season:"2022-23" },
    "Bam Adebayo|Miami|2020s": { ppg:20.4, rpg:9.2, apg:3.2, season:"2022-23" },
    "Tyler Herro|Miami|2020s": { ppg:20.1, rpg:5.4, apg:4.2, season:"2022-23" },
    "Kevin Love|Miami|2020s": { ppg:8.7, rpg:6.1, apg:1.7, season:"2022-23" },
    "Kyle Lowry|Miami|2020s": { ppg:8.6, rpg:3.5, apg:5.7, season:"2022-23" },

    // Charlotte Hornets — 1990s (from the 1994-95 50-32 team)
    "Alonzo Mourning|Charlotte|1990s": { ppg:21.3, rpg:10.2, apg:1.4, season:"1994-95" },
    "Larry Johnson|Charlotte|1990s": { ppg:18.8, rpg:8.2, apg:3.6, season:"1994-95" },
    "Hersey Hawkins|Charlotte|1990s": { ppg:15.9, rpg:3.5, apg:2.9, season:"1994-95" },
    "Dell Curry|Charlotte|1990s": { ppg:13.4, rpg:2.6, apg:2.0, season:"1994-95" },
    "Muggsy Bogues|Charlotte|1990s": { ppg:9.4, rpg:3.0, apg:8.8, season:"1994-95" },

    // Charlotte Bobcats — 2000s (from the 2009-10 44-38 team, franchise's first playoff appearance)
    "Gerald Wallace|Charlotte|2000s": { ppg:18.2, rpg:10.0, apg:2.4, season:"2009-10" },
    "Stephen Jackson|Charlotte|2000s": { ppg:21.1, rpg:5.1, apg:3.6, season:"2009-10" },
    "Raymond Felton|Charlotte|2000s": { ppg:14.4, rpg:3.8, apg:6.0, season:"2009-10" },
    "Boris Diaw|Charlotte|2000s": { ppg:8.9, rpg:4.7, apg:3.7, season:"2009-10" },
    "D.J. Augustin|Charlotte|2000s": { ppg:11.0, rpg:2.5, apg:5.0, season:"2009-10" },
    "Nazr Mohammed|Charlotte|2000s": { ppg:6.5, rpg:5.5, apg:0.5, season:"2009-10" },

    // Charlotte Bobcats — 2010s (from the 2013-14 43-39 team, second playoff berth in franchise history)
    "Al Jefferson|Charlotte|2010s": { ppg:21.8, rpg:10.8, apg:1.6, season:"2013-14" },
    "Kemba Walker|Charlotte|2010s": { ppg:17.7, rpg:4.2, apg:6.1, season:"2013-14" },
    "Gerald Henderson|Charlotte|2010s": { ppg:15.0, rpg:4.0, apg:1.5, season:"2013-14" },
    "Josh McRoberts|Charlotte|2010s": { ppg:8.6, rpg:4.7, apg:4.0, season:"2013-14" },
    "Michael Kidd-Gilchrist|Charlotte|2010s": { ppg:7.2, rpg:5.2, apg:0.8, season:"2013-14" },

    // Charlotte Hornets — 2020s (from the 2021-22 43-39 play-in team, LaMelo's real second-year All-Star season)
    "LaMelo Ball|Charlotte|2020s": { ppg:20.1, rpg:7.6, apg:6.4, season:"2021-22" },
    "Terry Rozier|Charlotte|2020s": { ppg:20.6, rpg:4.6, apg:4.9, season:"2021-22" },
    "Miles Bridges|Charlotte|2020s": { ppg:20.2, rpg:7.0, apg:3.4, season:"2021-22" },
    "Gordon Hayward|Charlotte|2020s": { ppg:19.6, rpg:5.4, apg:4.0, season:"2021-22" },
    "Mason Plumlee|Charlotte|2020s": { ppg:7.9, rpg:7.3, apg:2.7, season:"2021-22" },

    // Atlanta Hawks — 1990s (from the 1996-97 56-26 team)
    "Christian Laettner|Atlanta|1990s": { ppg:18.1, rpg:8.0, apg:2.7, season:"1996-97" },
    "Steve Smith|Atlanta|1990s": { ppg:18.1, rpg:3.9, apg:3.6, season:"1996-97" },
    "Mookie Blaylock|Atlanta|1990s": { ppg:13.9, rpg:4.3, apg:5.6, season:"1996-97" },
    "Dikembe Mutombo|Atlanta|1990s": { ppg:13.3, rpg:11.3, apg:1.1, season:"1996-97" },
    "Alan Henderson|Atlanta|1990s": { ppg:11.4, rpg:5.9, apg:1.1, season:"1996-97" },

    // Atlanta Hawks — 2010s (from the 2014-15 60-22 franchise-record #1 seed team)
    "Paul Millsap|Atlanta|2010s": { ppg:16.7, rpg:8.1, apg:3.1, season:"2014-15" },
    "Al Horford|Atlanta|2010s": { ppg:15.2, rpg:7.0, apg:3.4, season:"2014-15" },
    "Jeff Teague|Atlanta|2010s": { ppg:16.5, rpg:2.9, apg:7.0, season:"2014-15" },
    "Kyle Korver|Atlanta|2010s": { ppg:12.1, rpg:3.0, apg:2.2, season:"2014-15" },
    "DeMarre Carroll|Atlanta|2010s": { ppg:12.6, rpg:5.1, apg:1.4, season:"2014-15" },

    // Atlanta Hawks — 2000s (from the 2007-08 37-45 team that nearly upset the champion Celtics)
    "Joe Johnson|Atlanta|2000s": { ppg:21.7, rpg:4.1, apg:5.8, season:"2007-08" },
    "Josh Smith|Atlanta|2000s": { ppg:17.2, rpg:8.2, apg:2.9, season:"2007-08" },
    "Marvin Williams|Atlanta|2000s": { ppg:14.5, rpg:5.6, apg:1.4, season:"2007-08" },
    "Mike Bibby|Atlanta|2000s": { ppg:13.4, rpg:2.8, apg:5.0, season:"2007-08" },
    "Al Horford|Atlanta|2000s": { ppg:10.1, rpg:9.7, apg:1.5, season:"2007-08" },

    // Atlanta Hawks — 2020s (from the 2020-21 41-31 team, first Eastern Conference Finals since 1961)
    "Trae Young|Atlanta|2020s": { ppg:25.3, rpg:3.9, apg:9.4, season:"2020-21" },
    "John Collins|Atlanta|2020s": { ppg:17.6, rpg:7.4, apg:1.7, season:"2020-21" },
    "Clint Capela|Atlanta|2020s": { ppg:15.2, rpg:14.3, apg:1.5, season:"2020-21" },
    "Bogdan Bogdanović|Atlanta|2020s": { ppg:16.4, rpg:4.4, apg:3.4, season:"2020-21" },
    "Kevin Huerter|Atlanta|2020s": { ppg:11.5, rpg:3.3, apg:3.1, season:"2020-21" },

    // Denver — 1970s (from the 1976-77 team-season page)
    "David Thompson|Denver|1970s": { ppg:25.9, rpg:4.1, apg:4.1, season:"1976-77" },
    "Dan Issel|Denver|1970s": { ppg:22.3, rpg:8.8, apg:2.2, season:"1976-77" },
    "Bobby Jones|Denver|1970s": { ppg:15.1, rpg:8.3, apg:3.2, season:"1976-77" },
    "Ted McClain|Denver|1970s": { ppg:8.2, rpg:3.2, apg:4.5, season:"1976-77" },
    "Mack Calvin|Denver|1970s": { ppg:11.1, rpg:1.7, apg:4.0, season:"1976-77" },
    "Willie Wise|Denver|1970s": { ppg:8.2, rpg:3.4, apg:1.9, season:"1976-77" },
    "Paul Silas|Denver|1970s": { ppg:7.2, rpg:7.5, apg:1.6, season:"1976-77" },
    "Marvin Webster|Denver|1970s": { ppg:6.7, rpg:6.1, apg:0.8, season:"1976-77" },

    // Denver — 1980s (from the 1985-86 team-season page)
    "Fat Lever|Denver|1980s": { ppg:13.8, rpg:5.4, apg:7.5, season:"1985-86" },
    "T.R. Dunn|Denver|1980s": { ppg:5.0, rpg:4.6, apg:2.1, season:"1985-86" },
    "Calvin Natt|Denver|1980s": { ppg:17.7, rpg:6.3, apg:2.4, season:"1985-86" },
    "Wayne Cooper|Denver|1980s": { ppg:13.1, rpg:7.8, apg:1.0, season:"1985-86" },
    "Danny Schayes|Denver|1980s": { ppg:8.2, rpg:5.5, apg:1.0, season:"1985-86" },

    // Denver — 1990s (from the 1993-94 team-season page)
    "Bryant Stith|Denver|1990s": { ppg:12.5, rpg:4.3, apg:2.4, season:"1993-94" },
    "LaPhonso Ellis|Denver|1990s": { ppg:15.4, rpg:8.6, apg:2.1, season:"1993-94" },
    "Mahmoud Abdul-Rauf|Denver|1990s": { ppg:18.0, rpg:2.1, apg:4.5, season:"1993-94" },
    "Reggie Williams|Denver|1990s": { ppg:13.0, rpg:4.8, apg:3.7, season:"1993-94" },
    "Robert Pack|Denver|1990s": { ppg:9.6, rpg:1.9, apg:5.4, season:"1993-94" },

    // Denver — 2000s (from the 2007-08 team-season page)
    "Allen Iverson|Denver|2000s": { ppg:26.4, rpg:3.0, apg:7.1, season:"2007-08" },
    "Carmelo Anthony|Denver|2000s": { ppg:25.7, rpg:7.4, apg:3.4, season:"2007-08" },
    "Marcus Camby|Denver|2000s": { ppg:9.1, rpg:13.1, apg:3.3, season:"2007-08" },
    "Kenyon Martin|Denver|2000s": { ppg:12.4, rpg:6.5, apg:1.3, season:"2007-08" },
    "Anthony Carter|Denver|2000s": { ppg:7.8, rpg:2.9, apg:5.5, season:"2007-08" },
    "Linas Kleiza|Denver|2000s": { ppg:11.1, rpg:4.2, apg:1.2, season:"2007-08" },
    "Eduardo Nájera|Denver|2000s": { ppg:5.9, rpg:4.3, apg:1.2, season:"2007-08" },
    "J.R. Smith|Denver|2000s": { ppg:12.3, rpg:2.1, apg:1.7, season:"2007-08" },

    // Minnesota — 1990s (from the 1997-98 team-season page)
    "Kevin Garnett|Minnesota|1990s": { ppg:18.5, rpg:9.6, apg:4.2, season:"1997-98" },
    "Stephon Marbury|Minnesota|1990s": { ppg:17.7, rpg:2.8, apg:8.6, season:"1997-98" },
    "Tom Gugliotta|Minnesota|1990s": { ppg:20.1, rpg:8.7, apg:4.1, season:"1997-98" },
    "Doug West|Minnesota|1990s": { ppg:4.1, rpg:2.2, apg:1.2, season:"1997-98" },
    "Micheal Williams|Minnesota|1990s": { ppg:2.6, rpg:0.6, apg:1.3, season:"1997-98" },

    // Oklahoma City (Seattle SuperSonics) — 1990s (from the 1995-96 team-season page)
    "Gary Payton|Oklahoma City|1990s": { ppg:19.3, rpg:4.2, apg:7.5, season:"1995-96" },
    "Nate McMillan|Oklahoma City|1990s": { ppg:5.0, rpg:3.8, apg:3.6, season:"1995-96" },
    "Hersey Hawkins|Oklahoma City|1990s": { ppg:15.6, rpg:3.6, apg:2.7, season:"1995-96" },
    "Detlef Schrempf|Oklahoma City|1990s": { ppg:17.1, rpg:5.2, apg:4.4, season:"1995-96" },
    "Vincent Askew|Oklahoma City|1990s": { ppg:8.4, rpg:3.2, apg:2.4, season:"1995-96" },
    "Shawn Kemp|Oklahoma City|1990s": { ppg:19.6, rpg:11.4, apg:2.2, season:"1995-96" },
    "Sam Perkins|Oklahoma City|1990s": { ppg:11.8, rpg:4.5, apg:1.5, season:"1995-96" },
    "Ervin Johnson|Oklahoma City|1990s": { ppg:5.5, rpg:5.3, apg:0.6, season:"1995-96" },

    // Portland — 1990s (from the 1994-95 team-season page)
    "Terry Porter|Portland|1990s": { ppg:8.9, rpg:2.3, apg:3.8, season:"1994-95" },
    "Clyde Drexler|Portland|1990s": { ppg:22.0, rpg:5.7, apg:5.1, season:"1994-95" },
    "Rod Strickland|Portland|1990s": { ppg:18.9, rpg:5.0, apg:8.8, season:"1994-95" },
    "Jerome Kersey|Portland|1990s": { ppg:8.1, rpg:4.1, apg:1.3, season:"1994-95" },
    "Buck Williams|Portland|1990s": { ppg:9.2, rpg:8.2, apg:1.0, season:"1994-95" },
    "Cliff Robinson|Portland|1990s": { ppg:21.3, rpg:5.6, apg:2.6, season:"1994-95" },

    // Utah — 1990s (from the 1996-97 team-season page; Stockton's own best 1990s season,
    // 1990-91, is already listed above and is higher than this 1996-97 number, so it's kept)
    "Karl Malone|Utah|1990s": { ppg:27.4, rpg:9.9, apg:4.5, season:"1996-97" },
    "Jeff Hornacek|Utah|1990s": { ppg:14.5, rpg:2.9, apg:4.4, season:"1996-97" },
    "Bryon Russell|Utah|1990s": { ppg:10.8, rpg:4.1, apg:1.5, season:"1996-97" },
    "Greg Ostertag|Utah|1990s": { ppg:7.3, rpg:7.3, apg:0.4, season:"1996-97" },

    // Denver — 2010s (from the 2018-19 team-season page)
    "Jamal Murray|Denver|2010s": { ppg:18.2, rpg:4.2, apg:4.8, season:"2018-19" },
    "Nikola Jokić|Denver|2010s": { ppg:20.1, rpg:10.8, apg:7.3, season:"2018-19" },
    "Gary Harris|Denver|2010s": { ppg:12.9, rpg:2.8, apg:2.2, season:"2018-19" },
    "Paul Millsap|Denver|2010s": { ppg:12.6, rpg:7.2, apg:2.0, season:"2018-19" },

    // Oklahoma City — 2010s (from the 2011-12 Finals-run team-season page)
    "Kevin Durant|Oklahoma City|2010s": { ppg:28.0, rpg:8.0, apg:3.5, season:"2011-12" },
    "Russell Westbrook|Oklahoma City|2010s": { ppg:23.6, rpg:4.6, apg:5.5, season:"2011-12" },
    "James Harden|Oklahoma City|2010s": { ppg:16.8, rpg:4.1, apg:3.7, season:"2011-12" },
    "Serge Ibaka|Oklahoma City|2010s": { ppg:9.1, rpg:7.5, apg:0.4, season:"2011-12" },
    "Kendrick Perkins|Oklahoma City|2010s": { ppg:5.1, rpg:6.6, apg:1.2, season:"2011-12" },
    "Thabo Sefolosha|Oklahoma City|2010s": { ppg:4.8, rpg:3.0, apg:1.1, season:"2011-12" },
    "Nick Collison|Oklahoma City|2010s": { ppg:4.5, rpg:4.3, apg:1.3, season:"2011-12" },

    // Portland — 2010s (from the 2013-14 team-season page)
    "Damian Lillard|Portland|2010s": { ppg:20.7, rpg:3.5, apg:5.6, season:"2013-14" },
    "CJ McCollum|Portland|2010s": { ppg:5.3, rpg:1.3, apg:0.7, season:"2013-14" },
    "Wesley Matthews|Portland|2010s": { ppg:16.4, rpg:3.5, apg:2.4, season:"2013-14" },
    "Nicolas Batum|Portland|2010s": { ppg:13.0, rpg:7.5, apg:5.1, season:"2013-14" },
    "LaMarcus Aldridge|Portland|2010s": { ppg:23.2, rpg:11.1, apg:2.6, season:"2013-14" },
    "Robin Lopez|Portland|2010s": { ppg:11.1, rpg:8.5, apg:0.9, season:"2013-14" },

    // Denver — 2020s (from the 2022-23 NBA championship team-season page)
    "Jamal Murray|Denver|2020s": { ppg:20.0, rpg:4.0, apg:6.2, season:"2022-23" },
    "Kentavious Caldwell-Pope|Denver|2020s": { ppg:10.8, rpg:2.7, apg:2.4, season:"2022-23" },
    "Bones Hyland|Denver|2020s": { ppg:12.1, rpg:2.0, apg:3.0, season:"2022-23" },
    "Michael Porter Jr.|Denver|2020s": { ppg:17.4, rpg:5.5, apg:1.0, season:"2022-23" },
    "Bruce Brown|Denver|2020s": { ppg:11.5, rpg:4.1, apg:3.4, season:"2022-23" },
    "Aaron Gordon|Denver|2020s": { ppg:16.3, rpg:6.6, apg:3.0, season:"2022-23" },
    "Jeff Green|Denver|2020s": { ppg:7.8, rpg:2.6, apg:1.2, season:"2022-23" },
    "Nikola Jokić|Denver|2020s": { ppg:24.5, rpg:11.8, apg:9.8, season:"2022-23" },

    // Minnesota — 2000s (from the 2003-04 MVP-season team page)
    "Sam Cassell|Minnesota|2000s": { ppg:19.8, rpg:3.3, apg:7.3, season:"2003-04" },
    "Kevin Garnett|Minnesota|2000s": { ppg:24.2, rpg:13.9, apg:5.0, season:"2003-04" },
    "Wally Szczerbiak|Minnesota|2000s": { ppg:10.2, rpg:3.1, apg:1.2, season:"2003-04" },
    "Latrell Sprewell|Minnesota|2000s": { ppg:16.8, rpg:3.8, apg:3.5, season:"2003-04" },
    "Trenton Hassell|Minnesota|2000s": { ppg:5.0, rpg:3.2, apg:1.6, season:"2003-04" },
    "Mark Madsen|Minnesota|2000s": { ppg:3.6, rpg:3.8, apg:0.4, season:"2003-04" },

    // Utah — 2000s (from the 2007-08 team-season page)
    "Deron Williams|Utah|2000s": { ppg:18.8, rpg:3.0, apg:10.5, season:"2007-08" },
    "Carlos Boozer|Utah|2000s": { ppg:21.1, rpg:10.4, apg:2.9, season:"2007-08" },
    "Mehmet Okur|Utah|2000s": { ppg:14.5, rpg:7.7, apg:2.0, season:"2007-08" },
    "Andrei Kirilenko|Utah|2000s": { ppg:11.0, rpg:4.7, apg:4.0, season:"2007-08" },
    "Matt Harpring|Utah|2000s": { ppg:8.2, rpg:3.2, apg:1.1, season:"2007-08" },

    // Oklahoma City (Seattle SuperSonics) — 2000s (from the 2004-05 team-season page)
    "Ray Allen|Oklahoma City|2000s": { ppg:23.9, rpg:4.4, apg:3.7, season:"2004-05" },
    "Rashard Lewis|Oklahoma City|2000s": { ppg:20.5, rpg:5.5, apg:1.3, season:"2004-05" },
    "Nick Collison|Oklahoma City|2000s": { ppg:5.6, rpg:4.6, apg:0.4, season:"2004-05" },
    "Vladimir Radmanović|Oklahoma City|2000s": { ppg:11.8, rpg:4.6, apg:1.4, season:"2004-05" },
    "Jerome James|Oklahoma City|2000s": { ppg:4.9, rpg:3.0, apg:0.2, season:"2004-05" },

    // Portland — 2000s (from the 2002-03 team-season page)
    "Damon Stoudamire|Portland|2000s": { ppg:6.9, rpg:2.6, apg:3.5, season:"2002-03" },
    "Bonzi Wells|Portland|2000s": { ppg:15.2, rpg:5.3, apg:3.3, season:"2002-03" },
    "Derek Anderson|Portland|2000s": { ppg:13.9, rpg:3.5, apg:4.3, season:"2002-03" },
    "Ruben Patterson|Portland|2000s": { ppg:8.3, rpg:3.4, apg:1.3, season:"2002-03" },
    "Rasheed Wallace|Portland|2000s": { ppg:18.1, rpg:7.4, apg:2.1, season:"2002-03" },
    "Zach Randolph|Portland|2000s": { ppg:8.4, rpg:4.5, apg:0.5, season:"2002-03" },
    "Dale Davis|Portland|2000s": { ppg:7.4, rpg:7.2, apg:1.2, season:"2002-03" },

    // Minnesota — 2010s (from the 2015-16 team-season page)
    "Ricky Rubio|Minnesota|2010s": { ppg:10.1, rpg:4.3, apg:8.7, season:"2015-16" },
    "Zach LaVine|Minnesota|2010s": { ppg:14.0, rpg:2.8, apg:3.1, season:"2015-16" },
    "Andrew Wiggins|Minnesota|2010s": { ppg:20.7, rpg:3.6, apg:2.0, season:"2015-16" },
    "Shabazz Muhammad|Minnesota|2010s": { ppg:10.5, rpg:3.3, apg:0.6, season:"2015-16" },
    "Nemanja Bjelica|Minnesota|2010s": { ppg:5.1, rpg:3.5, apg:1.4, season:"2015-16" },
    "Kevin Garnett|Minnesota|2010s": { ppg:3.2, rpg:3.9, apg:1.6, season:"2015-16" },
    "Karl-Anthony Towns|Minnesota|2010s": { ppg:18.3, rpg:10.5, apg:2.0, season:"2015-16" },
    "Gorgui Dieng|Minnesota|2010s": { ppg:10.1, rpg:7.1, apg:1.7, season:"2015-16" },

    // Oklahoma City (Seattle SuperSonics) — 1970s (from the 1978-79 championship team-season page)
    "Gus Williams|Oklahoma City|1970s": { ppg:19.2, rpg:3.2, apg:4.0, season:"1978-79" },
    "Fred Brown|Oklahoma City|1970s": { ppg:14.0, rpg:2.2, apg:3.4, season:"1978-79" },
    "Dennis Johnson|Oklahoma City|1970s": { ppg:15.9, rpg:4.7, apg:3.5, season:"1978-79" },
    "Dick Snyder|Oklahoma City|1970s": { ppg:3.7, rpg:0.9, apg:1.1, season:"1978-79" },
    "John Johnson|Oklahoma City|1970s": { ppg:11.0, rpg:5.0, apg:4.4, season:"1978-79" },
    "Wally Walker|Oklahoma City|1970s": { ppg:6.6, rpg:3.0, apg:1.2, season:"1978-79" },
    "Lonnie Shelton|Oklahoma City|1970s": { ppg:13.5, rpg:6.2, apg:1.4, season:"1978-79" },
    "Paul Silas|Oklahoma City|1970s": { ppg:5.6, rpg:7.0, apg:1.4, season:"1978-79" },
    "Jack Sikma|Oklahoma City|1970s": { ppg:15.6, rpg:12.4, apg:3.2, season:"1978-79" },
    "Dennis Awtrey|Oklahoma City|1970s": { ppg:2.0, rpg:2.6, apg:1.2, season:"1978-79" },

    // Portland — 1970s (from the 1976-77 NBA championship team-season page)
    "Lionel Hollins|Portland|1970s": { ppg:14.7, rpg:2.8, apg:4.1, season:"1976-77" },
    "Dave Twardzik|Portland|1970s": { ppg:10.3, rpg:2.7, apg:3.3, season:"1976-77" },
    "Johnny Davis|Portland|1970s": { ppg:8.0, rpg:1.6, apg:1.9, season:"1976-77" },
    "Bob Gross|Portland|1970s": { ppg:11.4, rpg:4.8, apg:3.0, season:"1976-77" },
    "Maurice Lucas|Portland|1970s": { ppg:20.2, rpg:11.4, apg:2.9, season:"1976-77" },
    "Bill Walton|Portland|1970s": { ppg:18.6, rpg:14.4, apg:3.8, season:"1976-77" },

    // Utah — 1970s (from the 1978-79 New Orleans Jazz team-season page)
    "Gail Goodrich|Utah|1970s": { ppg:12.7, rpg:2.5, apg:4.8, season:"1978-79" },
    "Ron Lee|Utah|1970s": { ppg:6.7, rpg:3.2, apg:4.3, season:"1978-79" },
    "Pete Maravich|Utah|1970s": { ppg:22.6, rpg:2.5, apg:5.0, season:"1978-79" },
    "James McElroy|Utah|1970s": { ppg:16.9, rpg:2.7, apg:5.7, season:"1978-79" },
    "Spencer Haywood|Utah|1970s": { ppg:24.0, rpg:9.6, apg:2.1, season:"1978-79" },
    "Ira Terrell|Utah|1970s": { ppg:4.9, rpg:3.5, apg:0.8, season:"1978-79" },
    "Truck Robinson|Utah|1970s": { ppg:24.2, rpg:13.4, apg:1.7, season:"1978-79" },
    "Aaron James|Utah|1970s": { ppg:10.0, rpg:3.4, apg:1.1, season:"1978-79" },
    "Rich Kelley|Utah|1970s": { ppg:15.7, rpg:12.8, apg:3.6, season:"1978-79" },
    "Joe C. Meriweather|Utah|1970s": { ppg:6.1, rpg:5.1, apg:0.9, season:"1978-79" },

    // Oklahoma City (Seattle SuperSonics) — 1980s (from the 1986-87 team-season page)
    "Dale Ellis|Oklahoma City|1980s": { ppg:24.9, rpg:5.5, apg:2.9, season:"1986-87" },
    "Xavier McDaniel|Oklahoma City|1980s": { ppg:23.0, rpg:8.6, apg:2.5, season:"1986-87" },
    "Tom Chambers|Oklahoma City|1980s": { ppg:23.3, rpg:6.6, apg:3.0, season:"1986-87" },

    // Oklahoma City — 2020s (from the 2023-24 team-season page, MVP-runner-up season)
    "Shai Gilgeous-Alexander|Oklahoma City|2020s": { ppg:30.1, rpg:5.5, apg:6.2, season:"2023-24" },
    "Josh Giddey|Oklahoma City|2020s": { ppg:12.3, rpg:6.4, apg:4.8, season:"2023-24" },
    "Luguentz Dort|Oklahoma City|2020s": { ppg:10.9, rpg:3.6, apg:1.4, season:"2023-24" },
    "Aaron Wiggins|Oklahoma City|2020s": { ppg:6.9, rpg:2.4, apg:1.1, season:"2023-24" },
    "Jalen Williams|Oklahoma City|2020s": { ppg:19.1, rpg:4.0, apg:4.5, season:"2023-24" },
    "Isaiah Joe|Oklahoma City|2020s": { ppg:8.2, rpg:2.3, apg:1.3, season:"2023-24" },
    "Jaylin Williams|Oklahoma City|2020s": { ppg:4.0, rpg:3.4, apg:1.6, season:"2023-24" },
    "Kenrich Williams|Oklahoma City|2020s": { ppg:4.7, rpg:3.0, apg:1.3, season:"2023-24" },
    "Chet Holmgren|Oklahoma City|2020s": { ppg:16.5, rpg:7.9, apg:2.4, season:"2023-24" },

    // Portland — 1980s (from the 1984-85 team-season page)
    "Darnell Valentine|Portland|1980s": { ppg:11.6, rpg:2.9, apg:7.0, season:"1984-85" },
    "Jim Paxson|Portland|1980s": { ppg:17.9, rpg:3.3, apg:3.9, season:"1984-85" },
    "Clyde Drexler|Portland|1980s": { ppg:17.2, rpg:6.0, apg:5.5, season:"1984-85" },
    "Kiki Vandeweghe|Portland|1980s": { ppg:22.4, rpg:3.2, apg:1.5, season:"1984-85" },
    "Jerome Kersey|Portland|1980s": { ppg:6.1, rpg:2.7, apg:0.8, season:"1984-85" },
    "Kenny Carr|Portland|1980s": { ppg:10.4, rpg:6.7, apg:1.2, season:"1984-85" },
    "Mychal Thompson|Portland|1980s": { ppg:18.4, rpg:7.8, apg:2.6, season:"1984-85" },
    "Sam Bowie|Portland|1980s": { ppg:10.0, rpg:8.6, apg:2.8, season:"1984-85" },

    // Portland — 2020s (from the 2020-21 team-season page)
    "Damian Lillard|Portland|2020s": { ppg:28.8, rpg:4.2, apg:7.5, season:"2020-21" },
    "Anfernee Simons|Portland|2020s": { ppg:7.8, rpg:2.2, apg:1.4, season:"2020-21" },
    "CJ McCollum|Portland|2020s": { ppg:23.1, rpg:3.9, apg:4.7, season:"2020-21" },
    "Nassir Little|Portland|2020s": { ppg:4.6, rpg:2.7, apg:0.5, season:"2020-21" },
    "Robert Covington|Portland|2020s": { ppg:8.5, rpg:6.7, apg:1.7, season:"2020-21" },
    "Jusuf Nurkić|Portland|2020s": { ppg:11.5, rpg:9.0, apg:3.4, season:"2020-21" },

    // Utah — 2010s (from the 2018-19 team-season page)
    "Ricky Rubio|Utah|2010s": { ppg:12.7, rpg:3.6, apg:6.1, season:"2018-19" },
    "Donovan Mitchell|Utah|2010s": { ppg:23.8, rpg:4.1, apg:4.2, season:"2018-19" },
    "Alec Burks|Utah|2010s": { ppg:8.4, rpg:1.6, apg:1.2, season:"2018-19" },
    "Joe Ingles|Utah|2010s": { ppg:12.1, rpg:4.0, apg:5.7, season:"2018-19" },
    "Derrick Favors|Utah|2010s": { ppg:11.8, rpg:7.4, apg:1.2, season:"2018-19" },
    "Rudy Gobert|Utah|2010s": { ppg:15.9, rpg:12.9, apg:2.0, season:"2018-19" },

    // Utah — 2020s (from the 2021-22 team-season page, Northwest Division champions)
    "Donovan Mitchell|Utah|2020s": { ppg:25.9, rpg:4.2, apg:5.3, season:"2021-22" },
    "Rudy Gobert|Utah|2020s": { ppg:15.6, rpg:14.7, apg:1.1, season:"2021-22" },
    "Bojan Bogdanović|Utah|2020s": { ppg:18.1, rpg:4.3, apg:1.7, season:"2021-22" },
    "Mike Conley|Utah|2020s": { ppg:13.7, rpg:3.0, apg:5.3, season:"2021-22" },
    "Jordan Clarkson|Utah|2020s": { ppg:16.0, rpg:3.5, apg:2.5, season:"2021-22" },

    // Minnesota — 2020s (from the 2023-24 team-season page, Western Conference Finals team)
    "Anthony Edwards|Minnesota|2020s": { ppg:25.9, rpg:5.4, apg:5.1, season:"2023-24" },
    "Rudy Gobert|Minnesota|2020s": { ppg:14.0, rpg:12.9, apg:1.3, season:"2023-24" },
    "Karl-Anthony Towns|Minnesota|2020s": { ppg:21.8, rpg:8.3, apg:3.0, season:"2023-24" },
    "Jaden McDaniels|Minnesota|2020s": { ppg:10.5, rpg:3.1, apg:1.4, season:"2023-24" },
    "Mike Conley|Minnesota|2020s": { ppg:11.4, rpg:2.9, apg:5.9, season:"2023-24" },
    "Naz Reid|Minnesota|2020s": { ppg:13.5, rpg:5.2, apg:1.3, season:"2023-24" },
    "Kyle Anderson|Minnesota|2020s": { ppg:6.4, rpg:3.5, apg:4.2, season:"2023-24" },

    // Minnesota — completing all remaining gaps
    "Felton Spencer|Minnesota|1990s": { ppg:4.1, rpg:4.6, apg:0.2, season:"1992-93" },
    "Terrell Brandon|Minnesota|2000s": { ppg:16.0, rpg:3.8, apg:7.5, season:"2000-01" },
    "Rasho Nesterović|Minnesota|2000s": { ppg:4.5, rpg:3.9, apg:0.6, season:"2000-01" },

    // Minnesota — completing final gaps (2010s, 2020s)
    "Jeff Teague|Minnesota|2010s": { ppg:12.1, rpg:2.5, apg:8.2, season:"2018-19" },
    "D'Angelo Russell|Minnesota|2020s": { ppg:21.7, rpg:4.6, apg:6.6, season:"2019-20" },
    "Jaylen Nowell|Minnesota|2020s": { ppg:3.8, rpg:0.9, apg:1.3, season:"2019-20" },

    // Utah — 1980s (from the 1984-85 team-season page)
    "Rickey Green|Utah|1980s": { ppg:13.0, rpg:2.5, apg:7.8, season:"1984-85" },
    "Darrell Griffith|Utah|1980s": { ppg:22.6, rpg:4.4, apg:3.1, season:"1984-85" },
    "Adrian Dantley|Utah|1980s": { ppg:26.6, rpg:5.9, apg:3.4, season:"1984-85" },
    "Thurl Bailey|Utah|1980s": { ppg:15.2, rpg:6.6, apg:1.7, season:"1984-85" },
    "Mark Eaton|Utah|1980s": { ppg:9.7, rpg:11.3, apg:1.5, season:"1984-85" },
    "Rich Kelley|Utah|1980s": { ppg:3.8, rpg:4.5, apg:1.6, season:"1984-85" },

    // Denver — 2010s (from the 2013-14 team-season page, filling remaining roster gaps)
    "Ty Lawson|Denver|2010s": { ppg:17.6, rpg:3.5, apg:8.8, season:"2013-14" },
    "Randy Foye|Denver|2010s": { ppg:13.2, rpg:2.9, apg:3.5, season:"2013-14" },
    "Wilson Chandler|Denver|2010s": { ppg:13.6, rpg:4.7, apg:1.8, season:"2013-14" },
    "Kenneth Faried|Denver|2010s": { ppg:13.7, rpg:8.6, apg:1.2, season:"2013-14" },
    "JaVale McGee|Denver|2010s": { ppg:7.0, rpg:3.4, apg:0.4, season:"2013-14" },

    // Oklahoma City (Seattle SuperSonics) — 1980s (from the 1982-83 team-season page)
    "Gus Williams|Oklahoma City|1980s": { ppg:20.0, rpg:2.6, apg:8.0, season:"1982-83" },
    "Fred Brown|Oklahoma City|1980s": { ppg:10.2, rpg:1.2, apg:3.0, season:"1982-83" },
    "Danny Vranes|Oklahoma City|1980s": { ppg:6.9, rpg:5.2, apg:1.5, season:"1982-83" },
    "Jack Sikma|Oklahoma City|1980s": { ppg:18.2, rpg:11.4, apg:3.1, season:"1982-83" },

    // Utah — 2000s (from the 2002-03 team-season page)
    "Karl Malone|Utah|2000s": { ppg:20.6, rpg:7.8, apg:4.7, season:"2002-03" },
    "Greg Ostertag|Utah|2000s": { ppg:5.4, rpg:6.2, apg:0.7, season:"2002-03" },
    "Carlos Arroyo|Utah|2000s": { ppg:2.8, rpg:0.6, apg:1.2, season:"2002-03" },
    "DeShawn Stevenson|Utah|2000s": { ppg:4.6, rpg:1.4, apg:0.7, season:"2002-03" },

    // Utah — 1990s (from the 1996-97 NBA Finals team-season page)
    "Howard Eisley|Utah|1990s": { ppg:4.5, rpg:1.0, apg:2.4, season:"1996-97" },
    "Adam Keefe|Utah|1990s": { ppg:3.8, rpg:3.5, apg:0.5, season:"1996-97" },
    "Antoine Carr|Utah|1990s": { ppg:7.4, rpg:2.4, apg:0.9, season:"1996-97" },

    // Utah — 2010s continued (from the 2013-14 team-season page)
    "Trey Burke|Utah|2010s": { ppg:12.8, rpg:3.0, apg:5.7, season:"2013-14" },
    "Gordon Hayward|Utah|2010s": { ppg:16.2, rpg:5.1, apg:5.2, season:"2013-14" },
    "Enes Kanter|Utah|2010s": { ppg:12.3, rpg:7.5, apg:0.9, season:"2013-14" },

    // Denver — 1980s (from the 1981-82 team-season page)
    "David Thompson|Denver|1980s": { ppg:14.9, rpg:2.4, apg:1.9, season:"1981-82" },
    "Kiki Vandeweghe|Denver|1980s": { ppg:21.5, rpg:5.6, apg:3.0, season:"1981-82" },
    "Dan Issel|Denver|1980s": { ppg:22.9, rpg:7.5, apg:2.2, season:"1981-82" },

    // Denver — 2000s (from the 2004-05 team-season page)
    "Andre Miller|Denver|2000s": { ppg:13.6, rpg:4.1, apg:6.9, season:"2004-05" },
    "Earl Boykins|Denver|2000s": { ppg:12.4, rpg:1.7, apg:4.5, season:"2004-05" },
    "Nenê|Denver|2000s": { ppg:9.6, rpg:5.9, apg:1.5, season:"2004-05" },

    // Minnesota — 1990s continued (from the 1993-94 team-season page)
    "Isaiah Rider|Minnesota|1990s": { ppg:16.6, rpg:4.0, apg:2.6, season:"1993-94" },
    "Christian Laettner|Minnesota|1990s": { ppg:16.8, rpg:8.6, apg:4.4, season:"1993-94" },

    // Portland — 1990s continued (from the 1995-96 team-season page)
    "Arvydas Sabonis|Portland|1990s": { ppg:14.5, rpg:8.1, apg:1.8, season:"1995-96" },

    // Utah — 2020s continued (from the 2022-23 team-season page, Markkanen MIP year)
    "Lauri Markkanen|Utah|2020s": { ppg:25.6, rpg:8.6, apg:1.9, season:"2022-23" },
    "Collin Sexton|Utah|2020s": { ppg:14.3, rpg:2.2, apg:2.9, season:"2022-23" },
    "Walker Kessler|Utah|2020s": { ppg:9.2, rpg:8.4, apg:0.9, season:"2022-23" },

    // Utah — 1980s continued (from the 1985-86 team-season page, Malone's rookie year)
    "Karl Malone|Utah|1980s": { ppg:14.9, rpg:8.9, apg:2.9, season:"1985-86" },
    "Bobby Hansen|Utah|1980s": { ppg:8.7, rpg:3.0, apg:2.4, season:"1985-86" },

    // Utah — completing all remaining gaps
    "Mark Eaton|Utah|1990s": { ppg:3.3, rpg:6.1, apg:0.5, season:"1991-92" },
    "Raja Bell|Utah|2000s": { ppg:12.3, rpg:3.2, apg:1.4, season:"2004-05" },
    "Paul Millsap|Utah|2010s": { ppg:14.6, rpg:7.1, apg:2.6, season:"2012-13" },

    // OKC (Seattle SuperSonics) — 2000s continued
    "Gary Payton|Oklahoma City|2000s": { ppg:22.1, rpg:4.8, apg:9.0, season:"2001-02" },
    "Kevin Durant|Oklahoma City|2000s": { ppg:20.3, rpg:4.4, apg:2.4, season:"2007-08" },
    "Earl Watson|Oklahoma City|2000s": { ppg:10.7, rpg:2.9, apg:6.8, season:"2007-08" },
    "Johan Petro|Oklahoma City|2000s": { ppg:6.0, rpg:5.1, apg:0.4, season:"2007-08" },

    // OKC (Seattle SuperSonics) — 1980s and 1990s remaining gaps
    "Al Wood|Oklahoma City|1980s": { ppg:14.3, rpg:3.4, apg:2.0, season:"1983-84" },
    "Dale Ellis|Oklahoma City|1990s": { ppg:23.5, rpg:4.3, apg:2.0, season:"1989-90" },

    // OKC — completing all remaining gaps (2010s, 2020s)
    "Andre Roberson|Oklahoma City|2010s": { ppg:6.6, rpg:5.1, apg:1.0, season:"2016-17" },
    "Steven Adams|Oklahoma City|2010s": { ppg:11.3, rpg:7.7, apg:1.1, season:"2016-17" },
    "Isaiah Hartenstein|Oklahoma City|2020s": { ppg:11.2, rpg:10.7, apg:3.8, season:"2024-25" },
    "Antonio Daniels|Oklahoma City|2000s": { ppg:11.2, rpg:2.3, apg:4.1, season:"2004-05" },

    // Portland — 1970s completing (from the 1974-75 team-season page)
    "Geoff Petrie|Portland|1970s": { ppg:18.3, rpg:2.6, apg:5.3, season:"1974-75" },
    "Sidney Wicks|Portland|1970s": { ppg:21.7, rpg:10.7, apg:3.5, season:"1974-75" },

    // Portland — 1980s completing (Fat Lever rookie year + Steve Johnson All-Star/Duckworth MIP year)
    "Fat Lever|Portland|1980s": { ppg:7.8, rpg:2.8, apg:5.3, season:"1982-83" },
    "Steve Johnson|Portland|1980s": { ppg:15.4, rpg:5.6, apg:1.3, season:"1987-88" },
    "Kevin Duckworth|Portland|1990s": { ppg:15.8, rpg:6.6, apg:1.1, season:"1990-91" },
    "Danny Ainge|Portland|1990s": { ppg:11.1, rpg:2.6, apg:3.6, season:"1990-91" },

    // Portland — 2000s completing (2004-05 team-season page)
    "Sebastian Telfair|Portland|2000s": { ppg:6.8, rpg:1.5, apg:3.3, season:"2004-05" },
    "Travis Outlaw|Portland|2000s": { ppg:5.4, rpg:2.1, apg:0.6, season:"2004-05" },
    "Joel Przybilla|Portland|2000s": { ppg:6.4, rpg:7.7, apg:1.0, season:"2004-05" },

    // Portland — 2010s completing (2015-16 and 2018-19 team-season pages)
    "Al-Farouq Aminu|Portland|2010s": { ppg:10.2, rpg:6.1, apg:1.7, season:"2015-16" },
    "Maurice Harkless|Portland|2010s": { ppg:6.4, rpg:3.6, apg:0.9, season:"2015-16" },
    "Jusuf Nurkić|Portland|2010s": { ppg:15.6, rpg:10.4, apg:3.2, season:"2018-19" },

    // Portland — completing final 2020s gaps (2023-24 team-season page)
    "Jerami Grant|Portland|2020s": { ppg:21.0, rpg:3.5, apg:2.8, season:"2023-24" },
    "Deandre Ayton|Portland|2020s": { ppg:16.7, rpg:11.1, apg:1.6, season:"2023-24" },

    // Denver — completing all remaining gaps across every decade
    "Brian Taylor|Denver|1970s": { ppg:11.6, rpg:2.5, apg:3.4, season:"1977-78" },
    "Anthony Roberts|Denver|1970s": { ppg:9.5, rpg:4.3, apg:1.3, season:"1977-78" },
    "Antonio McDyess|Denver|1990s": { ppg:21.2, rpg:10.7, apg:1.6, season:"1998-99" },
    "Popeye Jones|Denver|1990s": { ppg:2.6, rpg:2.6, apg:0.5, season:"1999-00" },
    "Danilo Gallinari|Denver|2010s": { ppg:14.7, rpg:5.4, apg:1.6, season:"2010-11" },
    "Monte Morris|Denver|2020s": { ppg:10.2, rpg:2.0, apg:3.2, season:"2020-21" },

    // Los Angeles Lakers — 1970s (from the 1971-72 record-setting 69-13 title team)
    "Jerry West|Los Angeles L|1970s": { ppg:25.8, rpg:4.2, apg:9.7, season:"1971-72" },
    "Gail Goodrich|Los Angeles L|1970s": { ppg:25.9, rpg:3.6, apg:4.5, season:"1971-72" },
    "Wilt Chamberlain|Los Angeles L|1970s": { ppg:14.8, rpg:19.2, apg:4.0, season:"1971-72" },
    "Elgin Baylor|Los Angeles L|1970s": { ppg:11.8, rpg:6.3, apg:2.0, season:"1971-72" },
    "Happy Hairston|Los Angeles L|1970s": { ppg:13.1, rpg:13.1, apg:2.4, season:"1971-72" },
    "Jim McMillian|Los Angeles L|1970s": { ppg:18.8, rpg:6.5, apg:2.6, season:"1971-72" },
    "Kareem Abdul-Jabbar|Los Angeles L|1970s": { ppg:26.2, rpg:13.3, apg:3.9, season:"1976-77" },
    "Lucius Allen|Los Angeles L|1970s": { ppg:14.6, rpg:3.2, apg:5.2, season:"1976-77" },
    "Cazzie Russell|Los Angeles L|1970s": { ppg:16.4, rpg:3.6, apg:2.6, season:"1976-77" },
    "Jamaal Wilkes|Los Angeles L|1970s": { ppg:20.0, rpg:6.4, apg:3.0, season:"1979-80" },

    // Los Angeles Lakers — 1980s (from the 1986-87 65-17 championship team, Magic's MVP season)
    "Magic Johnson|Los Angeles L|1980s": { ppg:23.9, rpg:6.3, apg:12.2, season:"1986-87" },
    "James Worthy|Los Angeles L|1980s": { ppg:19.4, rpg:5.7, apg:2.8, season:"1986-87" },
    "Byron Scott|Los Angeles L|1980s": { ppg:17.0, rpg:3.5, apg:3.4, season:"1986-87" },
    "Kareem Abdul-Jabbar|Los Angeles L|1980s": { ppg:17.5, rpg:6.7, apg:2.6, season:"1986-87" },
    "A.C. Green|Los Angeles L|1980s": { ppg:10.8, rpg:7.8, apg:1.1, season:"1986-87" },
    "Michael Cooper|Los Angeles L|1980s": { ppg:10.5, rpg:3.1, apg:4.5, season:"1986-87" },
    "Mychal Thompson|Los Angeles L|1980s": { ppg:10.1, rpg:4.1, apg:0.8, season:"1986-87" },
    "Kurt Rambis|Los Angeles L|1980s": { ppg:5.7, rpg:5.8, apg:0.8, season:"1986-87" },
    "Norm Nixon|Los Angeles L|1980s": { ppg:17.6, rpg:2.1, apg:8.0, season:"1981-82" },
    "Jamaal Wilkes|Los Angeles L|1980s": { ppg:21.1, rpg:4.8, apg:1.7, season:"1981-82" },

    // Los Angeles Lakers — 1990s (from the 1990-91 Finals team, Magic's last full season)
    "Magic Johnson|Los Angeles L|1990s": { ppg:19.4, rpg:7.0, apg:12.5, season:"1990-91" },
    "Byron Scott|Los Angeles L|1990s": { ppg:14.5, rpg:3.0, apg:2.2, season:"1990-91" },
    "A.C. Green|Los Angeles L|1990s": { ppg:9.1, rpg:6.3, apg:0.9, season:"1990-91" },
    "Vlade Divac|Los Angeles L|1990s": { ppg:11.2, rpg:8.1, apg:1.1, season:"1990-91" },
    "Nick Van Exel|Los Angeles L|1990s": { ppg:16.9, rpg:2.8, apg:8.3, season:"1994-95" },
    "Cedric Ceballos|Los Angeles L|1990s": { ppg:21.7, rpg:8.0, apg:1.8, season:"1994-95" },
    "Eddie Jones|Los Angeles L|1990s": { ppg:14.0, rpg:3.9, apg:2.0, season:"1994-95" },
    "Elden Campbell|Los Angeles L|1990s": { ppg:12.5, rpg:6.1, apg:1.3, season:"1994-95" },
    "Shaquille O'Neal|Los Angeles L|1990s": { ppg:29.7, rpg:13.6, apg:3.8, season:"1999-00" },
    "Kobe Bryant|Los Angeles L|1990s": { ppg:22.5, rpg:6.3, apg:4.9, season:"1999-00" },

    // Los Angeles Lakers — 2000s (from the 2001-02 championship team, second three-peat title)
    "Kobe Bryant|Los Angeles L|2000s": { ppg:25.2, rpg:5.5, apg:5.5, season:"2001-02" },
    "Shaquille O'Neal|Los Angeles L|2000s": { ppg:27.2, rpg:10.7, apg:3.0, season:"2001-02" },
    "Derek Fisher|Los Angeles L|2000s": { ppg:11.2, rpg:2.1, apg:2.6, season:"2001-02" },
    "Rick Fox|Los Angeles L|2000s": { ppg:7.9, rpg:4.7, apg:3.5, season:"2001-02" },
    "Robert Horry|Los Angeles L|2000s": { ppg:6.8, rpg:5.9, apg:2.9, season:"2001-02" },
    "Brian Shaw|Los Angeles L|2000s": { ppg:2.9, rpg:1.9, apg:1.5, season:"2001-02" },
    "Devean George|Los Angeles L|2000s": { ppg:7.1, rpg:3.7, apg:1.4, season:"2001-02" },

    // Los Angeles Lakers — 2000s continued (from the 2005-06 team-season page, Kobe's 81-point season year)
    "Lamar Odom|Los Angeles L|2000s": { ppg:14.8, rpg:9.2, apg:5.5, season:"2005-06" },
    "Kwame Brown|Los Angeles L|2000s": { ppg:7.4, rpg:6.6, apg:1.0, season:"2005-06" },
    "Chris Mihm|Los Angeles L|2000s": { ppg:10.2, rpg:6.3, apg:1.0, season:"2005-06" },
    "Smush Parker|Los Angeles L|2000s": { ppg:11.5, rpg:3.3, apg:3.7, season:"2005-06" },
    "Luke Walton|Los Angeles L|2000s": { ppg:5.0, rpg:3.6, apg:2.3, season:"2005-06" },
    "Sasha Vujačić|Los Angeles L|2000s": { ppg:3.9, rpg:1.9, apg:1.7, season:"2005-06" },
    "Horace Grant|Los Angeles L|2000s": { ppg:8.5, rpg:7.1, apg:1.6, season:"2000-01" },
    "A.C. Green|Los Angeles L|2000s": { ppg:5.0, rpg:5.9, apg:1.0, season:"1999-00" },

    // Los Angeles Lakers — 2000s completing (from the 2008-09 65-17 championship team)
    "Pau Gasol|Los Angeles L|2000s": { ppg:18.9, rpg:9.6, apg:3.5, season:"2008-09" },
    "Andrew Bynum|Los Angeles L|2000s": { ppg:14.3, rpg:8.4, apg:1.5, season:"2008-09" },
    "Trevor Ariza|Los Angeles L|2000s": { ppg:8.9, rpg:3.9, apg:1.3, season:"2008-09" },
    "Jordan Farmar|Los Angeles L|2000s": { ppg:7.9, rpg:2.1, apg:2.9, season:"2008-09" },
    "Vladimir Radmanović|Los Angeles L|2000s": { ppg:6.0, rpg:3.5, apg:1.1, season:"2008-09" }
  };

  // Los Angeles Lakers — 2010s (from the 2012-13 star-studded team, five All-Stars)
  const BBALL_STATS_LAL2010S = {
    "Kobe Bryant|Los Angeles L|2010s": { ppg:27.3, rpg:5.6, apg:6.0, season:"2012-13" },
    "Steve Nash|Los Angeles L|2010s": { ppg:12.7, rpg:2.8, apg:6.7, season:"2012-13" },
    "Dwight Howard|Los Angeles L|2010s": { ppg:17.1, rpg:12.4, apg:1.4, season:"2012-13" },
    "Pau Gasol|Los Angeles L|2010s": { ppg:13.7, rpg:8.6, apg:4.1, season:"2012-13" },
    "D'Angelo Russell|Los Angeles L|2010s": { ppg:13.2, rpg:3.4, apg:3.3, season:"2015-16" },
    "Jordan Clarkson|Los Angeles L|2010s": { ppg:15.5, rpg:4.0, apg:2.4, season:"2015-16" },
    "Nick Young|Los Angeles L|2010s": { ppg:7.3, rpg:1.8, apg:0.6, season:"2015-16" },
    "Julius Randle|Los Angeles L|2010s": { ppg:11.3, rpg:10.2, apg:1.8, season:"2015-16" },
    "LeBron James|Los Angeles L|2010s": { ppg:27.4, rpg:8.5, apg:8.3, season:"2018-19" },
    "Brandon Ingram|Los Angeles L|2010s": { ppg:18.3, rpg:5.1, apg:3.0, season:"2018-19" }
  };

  // Los Angeles Lakers — 2020s (from the 2021-22 Westbrook-era team)
  const BBALL_STATS_LAL2020S = {
    "LeBron James|Los Angeles L|2020s": { ppg:30.3, rpg:8.2, apg:6.2, season:"2021-22" },
    "Anthony Davis|Los Angeles L|2020s": { ppg:23.2, rpg:9.9, apg:3.1, season:"2021-22" },
    "Russell Westbrook|Los Angeles L|2020s": { ppg:18.5, rpg:7.4, apg:7.1, season:"2021-22" },
    "Austin Reaves|Los Angeles L|2020s": { ppg:7.3, rpg:3.2, apg:1.8, season:"2021-22" },
    "D'Angelo Russell|Los Angeles L|2020s": { ppg:18.0, rpg:3.1, apg:6.3, season:"2023-24" },
    "Rui Hachimura|Los Angeles L|2020s": { ppg:13.6, rpg:4.3, apg:1.2, season:"2023-24" },
    "Jarred Vanderbilt|Los Angeles L|2020s": { ppg:5.2, rpg:4.8, apg:1.2, season:"2023-24" },
    "Luka Dončić|Los Angeles L|2020s": { ppg:28.2, rpg:8.1, apg:7.5, season:"2024-25" },
    "Dennis Schröder|Los Angeles L|2020s": { ppg:15.4, rpg:3.5, apg:5.8, season:"2020-21" },

    // Los Angeles Clippers — 1970s (Buffalo Braves era, from the 1973-74 conference semifinalist team)
    "Bob McAdoo|Los Angeles C|1970s": { ppg:30.6, rpg:15.1, apg:2.3, season:"1973-74" },
    "Jim McMillian|Los Angeles C|1970s": { ppg:18.6, rpg:7.4, apg:3.1, season:"1973-74" },
    "Randy Smith|Los Angeles C|1970s": { ppg:15.5, rpg:3.8, apg:4.7, season:"1973-74" },
    "Gar Heard|Los Angeles C|1970s": { ppg:15.3, rpg:11.7, apg:2.2, season:"1973-74" },
    "Ernie DiGregorio|Los Angeles C|1970s": { ppg:15.2, rpg:2.7, apg:8.2, season:"1973-74" },
    "Adrian Dantley|Los Angeles C|1970s": { ppg:20.3, rpg:7.6, apg:1.9, season:"1976-77" },
    "John Shumate|Los Angeles C|1970s": { ppg:15.1, rpg:9.5, apg:2.1, season:"1976-77" },
    "Swen Nater|Los Angeles C|1970s": { ppg:15.5, rpg:13.2, apg:2.8, season:"1977-78" },

    // Los Angeles Clippers — 1980s (from the 1984-85 team, franchise's first LA season)
    "Norm Nixon|Los Angeles C|1980s": { ppg:17.2, rpg:2.7, apg:8.8, season:"1984-85" },
    "Derek Smith|Los Angeles C|1980s": { ppg:22.1, rpg:5.3, apg:2.7, season:"1984-85" },
    "Bill Walton|Los Angeles C|1980s": { ppg:10.1, rpg:9.0, apg:2.3, season:"1984-85" },
    "Michael Cage|Los Angeles C|1980s": { ppg:7.1, rpg:5.2, apg:0.7, season:"1984-85" },
    "Junior Bridgeman|Los Angeles C|1980s": { ppg:13.9, rpg:2.9, apg:2.1, season:"1984-85" },
    "World B. Free|Los Angeles C|1980s": { ppg:30.2, rpg:3.5, apg:4.2, season:"1979-80" },
    "Terry Cummings|Los Angeles C|1980s": { ppg:23.7, rpg:10.6, apg:2.5, season:"1982-83" },

    // Los Angeles Clippers — 1990s (from the 1992-93 playoff team)
    "Mark Jackson|Los Angeles C|1990s": { ppg:14.4, rpg:4.7, apg:8.8, season:"1992-93" },
    "Ron Harper|Los Angeles C|1990s": { ppg:18.0, rpg:5.3, apg:4.5, season:"1992-93" },
    "Danny Manning|Los Angeles C|1990s": { ppg:22.8, rpg:6.6, apg:2.6, season:"1992-93" },
    "Loy Vaught|Los Angeles C|1990s": { ppg:9.4, rpg:6.2, apg:0.7, season:"1992-93" },
    "Pooh Richardson|Los Angeles C|1990s": { ppg:11.7, rpg:2.5, apg:5.4, season:"1995-96" },
    "Rodney Rogers|Los Angeles C|1990s": { ppg:11.6, rpg:4.3, apg:2.5, season:"1995-96" },
    "Malik Sealy|Los Angeles C|1990s": { ppg:11.5, rpg:3.9, apg:1.9, season:"1995-96" },
    "Lamond Murray|Los Angeles C|1990s": { ppg:8.4, rpg:3.2, apg:1.1, season:"1995-96" }
  };

  // Los Angeles Clippers — 2000s (from the 2005-06 47-35 playoff team, franchise's best in decades)
  const BBALL_STATS_LAC2000S = {
    "Elton Brand|Los Angeles C|2000s": { ppg:24.7, rpg:10.0, apg:2.6, season:"2005-06" },
    "Sam Cassell|Los Angeles C|2000s": { ppg:17.2, rpg:3.7, apg:6.3, season:"2005-06" },
    "Cuttino Mobley|Los Angeles C|2000s": { ppg:14.8, rpg:4.3, apg:3.0, season:"2005-06" },
    "Chris Kaman|Los Angeles C|2000s": { ppg:11.9, rpg:9.6, apg:1.0, season:"2005-06" },
    "Corey Maggette|Los Angeles C|2000s": { ppg:17.8, rpg:5.3, apg:2.1, season:"2005-06" },
    "Shaun Livingston|Los Angeles C|2000s": { ppg:5.8, rpg:3.0, apg:4.5, season:"2005-06" },
    "Quentin Richardson|Los Angeles C|2000s": { ppg:17.2, rpg:6.4, apg:2.1, season:"2003-04" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_LAC2000S);

  // Los Angeles Clippers — 2010s (from the 2015-16 53-29 Lob City team)
  const BBALL_STATS_LAC2010S = {
    "Chris Paul|Los Angeles C|2010s": { ppg:19.5, rpg:4.2, apg:10.0, season:"2015-16" },
    "Blake Griffin|Los Angeles C|2010s": { ppg:21.4, rpg:8.4, apg:4.9, season:"2015-16" },
    "DeAndre Jordan|Los Angeles C|2010s": { ppg:12.7, rpg:13.8, apg:1.2, season:"2015-16" },
    "J.J. Redick|Los Angeles C|2010s": { ppg:16.3, rpg:1.9, apg:1.4, season:"2015-16" },
    "Jamal Crawford|Los Angeles C|2010s": { ppg:14.2, rpg:1.8, apg:2.3, season:"2015-16" },
    "Paul Pierce|Los Angeles C|2010s": { ppg:6.1, rpg:2.7, apg:1.0, season:"2015-16" },
    "Austin Rivers|Los Angeles C|2010s": { ppg:8.9, rpg:1.9, apg:1.5, season:"2015-16" },
    "Danilo Gallinari|Los Angeles C|2010s": { ppg:19.8, rpg:6.1, apg:2.6, season:"2018-19" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_LAC2010S);

  // Los Angeles Clippers — 2020s (from the 2020-21 47-25 conference finals team)
  const BBALL_STATS_LAC2020S = {
    "Kawhi Leonard|Los Angeles C|2020s": { ppg:24.8, rpg:6.5, apg:5.2, season:"2020-21" },
    "Paul George|Los Angeles C|2020s": { ppg:23.3, rpg:6.6, apg:5.2, season:"2020-21" },
    "Marcus Morris|Los Angeles C|2020s": { ppg:13.4, rpg:4.1, apg:1.0, season:"2020-21" },
    "Reggie Jackson|Los Angeles C|2020s": { ppg:10.7, rpg:2.9, apg:3.1, season:"2020-21" },
    "Ivica Zubac|Los Angeles C|2020s": { ppg:9.0, rpg:7.2, apg:1.3, season:"2020-21" },
    "Terance Mann|Los Angeles C|2020s": { ppg:7.0, rpg:3.6, apg:1.6, season:"2020-21" },
    "James Harden|Los Angeles C|2020s": { ppg:22.8, rpg:5.8, apg:8.7, season:"2024-25" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_LAC2020S);

  // Golden State Warriors — 1970s (from the 1974-75 championship team, swept the Bullets)
  const BBALL_STATS_GSW1970S = {
    "Rick Barry|Golden State|1970s": { ppg:30.6, rpg:5.7, apg:6.2, season:"1974-75" },
    "Jamaal Wilkes|Golden State|1970s": { ppg:14.2, rpg:8.2, apg:2.2, season:"1974-75" },
    "Charles Johnson|Golden State|1970s": { ppg:10.9, rpg:3.9, apg:3.0, season:"1974-75" },
    "Clifford Ray|Golden State|1970s": { ppg:9.4, rpg:10.6, apg:2.2, season:"1974-75" },
    "Phil Smith|Golden State|1970s": { ppg:11.4, rpg:2.5, apg:2.9, season:"1974-75" },
    "Jeff Mullins|Golden State|1970s": { ppg:9.4, rpg:2.4, apg:2.4, season:"1974-75" },
    "George Johnson|Golden State|1970s": { ppg:4.5, rpg:5.6, apg:0.6, season:"1974-75" },
    "Nate Thurmond|Golden State|1970s": { ppg:17.1, rpg:17.1, apg:3.5, season:"1972-73" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_GSW1970S);

  // Golden State Warriors — 1980s (from the 1986-87 42-40 playoff team)
  const BBALL_STATS_GSW1980S = {
    "Sleepy Floyd|Golden State|1980s": { ppg:18.8, rpg:3.3, apg:10.3, season:"1986-87" },
    "Joe Barry Carroll|Golden State|1980s": { ppg:21.2, rpg:7.3, apg:2.6, season:"1986-87" },
    "Larry Smith|Golden State|1980s": { ppg:8.8, rpg:11.5, apg:1.2, season:"1986-87" },
    "Chris Mullin|Golden State|1980s": { ppg:15.1, rpg:2.2, apg:3.2, season:"1986-87" },
    "Purvis Short|Golden State|1980s": { ppg:18.3, rpg:4.0, apg:2.5, season:"1986-87" },
    "Terry Teagle|Golden State|1980s": { ppg:11.2, rpg:2.1, apg:1.3, season:"1986-87" },
    "World B. Free|Golden State|1980s": { ppg:24.1, rpg:2.4, apg:5.6, season:"1980-81" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_GSW1980S);

  // Golden State Warriors — 1990s (from the 1990-91 "Run TMC" 44-38 playoff team)
  const BBALL_STATS_GSW1990S = {
    "Chris Mullin|Golden State|1990s": { ppg:25.7, rpg:5.4, apg:4.0, season:"1990-91" },
    "Mitch Richmond|Golden State|1990s": { ppg:23.9, rpg:5.9, apg:3.1, season:"1990-91" },
    "Tim Hardaway|Golden State|1990s": { ppg:22.9, rpg:4.0, apg:9.7, season:"1990-91" },
    "Sarunas Marciulionis|Golden State|1990s": { ppg:10.9, rpg:2.4, apg:1.7, season:"1990-91" },
    "Latrell Sprewell|Golden State|1990s": { ppg:21.0, rpg:4.9, apg:4.7, season:"1993-94" },
    "Billy Owens|Golden State|1990s": { ppg:15.0, rpg:8.1, apg:4.1, season:"1993-94" },
    "Chris Webber|Golden State|1990s": { ppg:17.5, rpg:9.1, apg:3.6, season:"1993-94" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_GSW1990S);

  // Golden State Warriors — 2000s (from the 2007-08 48-34 "We Believe" follow-up team)
  const BBALL_STATS_GSW2000S = {
    "Baron Davis|Golden State|2000s": { ppg:21.8, rpg:4.7, apg:7.6, season:"2007-08" },
    "Monta Ellis|Golden State|2000s": { ppg:20.2, rpg:5.0, apg:3.9, season:"2007-08" },
    "Stephen Jackson|Golden State|2000s": { ppg:20.1, rpg:4.4, apg:4.1, season:"2007-08" },
    "Al Harrington|Golden State|2000s": { ppg:13.6, rpg:5.4, apg:1.6, season:"2007-08" },
    "Andris Biedrins|Golden State|2000s": { ppg:10.5, rpg:9.8, apg:1.0, season:"2007-08" },
    "Jason Richardson|Golden State|2000s": { ppg:21.7, rpg:5.9, apg:3.9, season:"2004-05" },
    "Troy Murphy|Golden State|2000s": { ppg:15.4, rpg:10.8, apg:1.4, season:"2004-05" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_GSW2000S);

  // Golden State Warriors — 2010s (from the 2015-16 record-setting 73-9 team)
  const BBALL_STATS_GSW2010S = {
    "Stephen Curry|Golden State|2010s": { ppg:30.1, rpg:5.4, apg:6.7, season:"2015-16" },
    "Klay Thompson|Golden State|2010s": { ppg:22.1, rpg:3.8, apg:2.1, season:"2015-16" },
    "Draymond Green|Golden State|2010s": { ppg:14.0, rpg:9.5, apg:7.4, season:"2015-16" },
    "Andre Iguodala|Golden State|2010s": { ppg:7.0, rpg:4.0, apg:3.4, season:"2015-16" },
    "Andrew Bogut|Golden State|2010s": { ppg:5.4, rpg:7.0, apg:2.3, season:"2015-16" },
    "Harrison Barnes|Golden State|2010s": { ppg:11.7, rpg:4.9, apg:1.8, season:"2015-16" },
    "Kevin Durant|Golden State|2010s": { ppg:26.4, rpg:6.8, apg:5.4, season:"2017-18" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_GSW2010S);

  // Golden State Warriors — 2020s (from the 2021-22 NBA champion team)
  const BBALL_STATS_GSW2020S = {
    "Stephen Curry|Golden State|2020s": { ppg:25.5, rpg:5.2, apg:6.3, season:"2021-22" },
    "Klay Thompson|Golden State|2020s": { ppg:20.4, rpg:3.9, apg:2.8, season:"2021-22" },
    "Jordan Poole|Golden State|2020s": { ppg:18.5, rpg:3.4, apg:4.0, season:"2021-22" },
    "Andrew Wiggins|Golden State|2020s": { ppg:17.2, rpg:4.5, apg:2.2, season:"2021-22" },
    "Draymond Green|Golden State|2020s": { ppg:7.5, rpg:7.3, apg:7.0, season:"2021-22" },
    "Kevon Looney|Golden State|2020s": { ppg:6.0, rpg:7.3, apg:2.0, season:"2021-22" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_GSW2020S);

  // Phoenix Suns — 1970s (from the 1975-76 team that reached the NBA Finals)
  const BBALL_STATS_PHO1970S = {
    "Paul Westphal|Phoenix|1970s": { ppg:20.5, rpg:3.2, apg:5.4, season:"1975-76" },
    "Alvan Adams|Phoenix|1970s": { ppg:19.0, rpg:9.1, apg:5.6, season:"1975-76" },
    "Curtis Perry|Phoenix|1970s": { ppg:13.3, rpg:9.6, apg:2.6, season:"1975-76" },
    "Dick Van Arsdale|Phoenix|1970s": { ppg:12.9, rpg:2.4, apg:2.4, season:"1975-76" },
    "Gar Heard|Phoenix|1970s": { ppg:12.4, rpg:9.9, apg:1.8, season:"1975-76" },
    "Connie Hawkins|Phoenix|1970s": { ppg:24.6, rpg:10.4, apg:4.8, season:"1969-70" },
    "Charlie Scott|Phoenix|1970s": { ppg:24.3, rpg:4.0, apg:4.5, season:"1974-75" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_PHO1970S);

  // Phoenix Suns — 1980s (from the 1984-85 team)
  const BBALL_STATS_PHO1980S = {
    "Larry Nance|Phoenix|1980s": { ppg:19.9, rpg:8.8, apg:2.6, season:"1984-85" },
    "Kyle Macy|Phoenix|1980s": { ppg:11.0, rpg:2.8, apg:5.8, season:"1984-85" },
    "Maurice Lucas|Phoenix|1980s": { ppg:13.4, rpg:8.8, apg:2.3, season:"1984-85" },
    "Alvan Adams|Phoenix|1980s": { ppg:14.7, rpg:6.1, apg:3.8, season:"1984-85" },
    "Jay Humphries|Phoenix|1980s": { ppg:8.8, rpg:2.1, apg:4.4, season:"1984-85" },
    "James Edwards|Phoenix|1980s": { ppg:14.9, rpg:5.5, apg:2.2, season:"1984-85" },
    "Walter Davis|Phoenix|1980s": { ppg:15.0, rpg:1.5, apg:4.3, season:"1984-85" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_PHO1980S);

  // Phoenix Suns — 1990s (from the 1993-94 56-26 team)
  const BBALL_STATS_PHO1990S = {
    "Kevin Johnson|Phoenix|1990s": { ppg:20.0, rpg:2.5, apg:9.5, season:"1993-94" },
    "Dan Majerle|Phoenix|1990s": { ppg:16.5, rpg:4.4, apg:3.4, season:"1993-94" },
    "Charles Barkley|Phoenix|1990s": { ppg:21.6, rpg:11.2, apg:4.6, season:"1993-94" },
    "A.C. Green|Phoenix|1990s": { ppg:14.7, rpg:9.2, apg:1.7, season:"1993-94" },
    "Danny Ainge|Phoenix|1990s": { ppg:8.9, rpg:1.9, apg:2.6, season:"1993-94" },
    "Tom Chambers|Phoenix|1990s": { ppg:27.2, rpg:7.0, apg:2.3, season:"1989-90" },
    "Jason Kidd|Phoenix|1990s": { ppg:16.9, rpg:6.8, apg:10.8, season:"1998-99" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_PHO1990S);

  // Phoenix Suns — 2000s (from the 2004-05 62-20 "Seven Seconds or Less" team, Nash's first MVP)
  const BBALL_STATS_PHO2000S = {
    "Steve Nash|Phoenix|2000s": { ppg:15.5, rpg:3.3, apg:11.5, season:"2004-05" },
    "Amar'e Stoudemire|Phoenix|2000s": { ppg:26.0, rpg:8.9, apg:1.6, season:"2004-05" },
    "Shawn Marion|Phoenix|2000s": { ppg:19.4, rpg:11.3, apg:1.9, season:"2004-05" },
    "Joe Johnson|Phoenix|2000s": { ppg:17.1, rpg:5.1, apg:3.5, season:"2004-05" },
    "Quentin Richardson|Phoenix|2000s": { ppg:14.9, rpg:6.1, apg:2.0, season:"2004-05" },
    "Leandro Barbosa|Phoenix|2000s": { ppg:7.0, rpg:2.1, apg:2.0, season:"2004-05" },
    "Boris Diaw|Phoenix|2000s": { ppg:13.3, rpg:6.9, apg:6.2, season:"2005-06" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_PHO2000S);

  // Phoenix Suns — 2010s (from the 2014-15 team)
  const BBALL_STATS_PHO2010S = {
    "Eric Bledsoe|Phoenix|2010s": { ppg:17.0, rpg:5.2, apg:6.1, season:"2014-15" },
    "Goran Dragic|Phoenix|2010s": { ppg:16.2, rpg:3.6, apg:4.1, season:"2014-15" },
    "Markieff Morris|Phoenix|2010s": { ppg:15.3, rpg:6.2, apg:2.3, season:"2014-15" },
    "P.J. Tucker|Phoenix|2010s": { ppg:9.1, rpg:6.4, apg:1.6, season:"2014-15" },
    "Devin Booker|Phoenix|2010s": { ppg:22.1, rpg:3.2, apg:3.4, season:"2016-17" },
    "Channing Frye|Phoenix|2010s": { ppg:12.7, rpg:6.7, apg:1.6, season:"2010-11" },
    "Steve Nash|Phoenix|2010s": { ppg:12.5, rpg:3.0, apg:10.7, season:"2011-12" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_PHO2010S);

  // Phoenix Suns — 2020s (from the 2021-22 franchise-record 64-18 team)
  const BBALL_STATS_PHO2020S = {
    "Devin Booker|Phoenix|2020s": { ppg:26.8, rpg:5.0, apg:4.8, season:"2021-22" },
    "Chris Paul|Phoenix|2020s": { ppg:14.7, rpg:4.4, apg:10.8, season:"2021-22" },
    "Mikal Bridges|Phoenix|2020s": { ppg:14.2, rpg:4.2, apg:2.3, season:"2021-22" },
    "Deandre Ayton|Phoenix|2020s": { ppg:17.2, rpg:10.2, apg:1.4, season:"2021-22" },
    "Jae Crowder|Phoenix|2020s": { ppg:9.4, rpg:5.3, apg:1.9, season:"2021-22" },
    "Kevin Durant|Phoenix|2020s": { ppg:29.1, rpg:6.7, apg:5.0, season:"2022-23" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_PHO2020S);

  // Sacramento Kings — 1970s (Kansas City-Omaha Kings era, from the 1974-75 team)
  const BBALL_STATS_SAC1970S = {
    "Nate Archibald|Sacramento|1970s": { ppg:26.5, rpg:2.7, apg:6.8, season:"1974-75" },
    "Jimmy Walker|Sacramento|1970s": { ppg:16.7, rpg:3.0, apg:2.8, season:"1974-75" },
    "Sam Lacey|Sacramento|1970s": { ppg:11.5, rpg:14.2, apg:5.3, season:"1974-75" },
    "Scott Wedman|Sacramento|1970s": { ppg:11.1, rpg:6.1, apg:1.6, season:"1974-75" },
    "Ron Behagen|Sacramento|1970s": { ppg:10.7, rpg:7.3, apg:1.9, season:"1974-75" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_SAC1970S);

  // Sacramento Kings — 1980s (from the 1987-88 team, Kenny Smith's rookie year)
  const BBALL_STATS_SAC1980S = {
    "Reggie Theus|Sacramento|1980s": { ppg:21.6, rpg:3.2, apg:6.3, season:"1987-88" },
    "Otis Thorpe|Sacramento|1980s": { ppg:20.8, rpg:10.2, apg:3.2, season:"1987-88" },
    "Kenny Smith|Sacramento|1980s": { ppg:13.8, rpg:2.3, apg:7.1, season:"1987-88" },
    "LaSalle Thompson|Sacramento|1980s": { ppg:8.0, rpg:6.2, apg:1.0, season:"1987-88" },
    "Mike Woodson|Sacramento|1980s": { ppg:18.7, rpg:2.8, apg:2.8, season:"1985-86" },
    "Eddie Johnson|Sacramento|1980s": { ppg:18.7, rpg:4.4, apg:3.1, season:"1986-87" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_SAC1980S);

  // Sacramento Kings — 1990s (from the 1994-95 team)
  const BBALL_STATS_SAC1990S = {
    "Mitch Richmond|Sacramento|1990s": { ppg:22.8, rpg:4.4, apg:3.8, season:"1994-95" },
    "Walt Williams|Sacramento|1990s": { ppg:16.4, rpg:4.5, apg:4.1, season:"1994-95" },
    "Olden Polynice|Sacramento|1990s": { ppg:10.8, rpg:9.0, apg:0.8, season:"1994-95" },
    "Lionel Simmons|Sacramento|1990s": { ppg:5.6, rpg:3.4, apg:1.5, season:"1994-95" },
    "Bobby Hurley|Sacramento|1990s": { ppg:4.2, rpg:1.0, apg:3.3, season:"1994-95" },
    "Billy Owens|Sacramento|1990s": { ppg:11.0, rpg:5.9, apg:2.9, season:"1996-97" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_SAC1990S);

  // Sacramento Kings — 2000s (from the 2001-02 61-21 "Greatest Show on Court" team)
  const BBALL_STATS_SAC2000S = {
    "Chris Webber|Sacramento|2000s": { ppg:24.5, rpg:10.1, apg:4.8, season:"2001-02" },
    "Peja Stojaković|Sacramento|2000s": { ppg:21.2, rpg:5.3, apg:2.5, season:"2001-02" },
    "Doug Christie|Sacramento|2000s": { ppg:12.0, rpg:4.6, apg:4.2, season:"2001-02" },
    "Mike Bibby|Sacramento|2000s": { ppg:13.7, rpg:2.8, apg:5.0, season:"2001-02" },
    "Vlade Divac|Sacramento|2000s": { ppg:11.1, rpg:8.4, apg:3.7, season:"2001-02" },
    "Bobby Jackson|Sacramento|2000s": { ppg:11.1, rpg:3.1, apg:2.0, season:"2001-02" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_SAC2000S);

  // Sacramento Kings — 2010s (from the 2013-14 team)
  const BBALL_STATS_SAC2010S = {
    "DeMarcus Cousins|Sacramento|2010s": { ppg:22.7, rpg:11.7, apg:2.9, season:"2013-14" },
    "Isaiah Thomas|Sacramento|2010s": { ppg:20.3, rpg:2.9, apg:6.3, season:"2013-14" },
    "Rudy Gay|Sacramento|2010s": { ppg:20.1, rpg:5.5, apg:3.1, season:"2013-14" },
    "Ben McLemore|Sacramento|2010s": { ppg:8.8, rpg:2.9, apg:1.0, season:"2013-14" },
    "Tyreke Evans|Sacramento|2010s": { ppg:20.1, rpg:5.3, apg:5.8, season:"2009-10" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_SAC2010S);

  // Sacramento Kings — 2020s (from the 2022-23 48-34 "Beam Team", ended 16-year playoff drought)
  const BBALL_STATS_SAC2020S = {
    "Domantas Sabonis|Sacramento|2020s": { ppg:19.1, rpg:12.3, apg:7.3, season:"2022-23" },
    "De'Aaron Fox|Sacramento|2020s": { ppg:25.0, rpg:4.2, apg:6.1, season:"2022-23" },
    "Harrison Barnes|Sacramento|2020s": { ppg:15.0, rpg:4.5, apg:1.6, season:"2022-23" },
    "Kevin Huerter|Sacramento|2020s": { ppg:15.2, rpg:3.3, apg:2.9, season:"2022-23" },
    "Malik Monk|Sacramento|2020s": { ppg:13.5, rpg:2.6, apg:3.9, season:"2022-23" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_SAC2020S);

  // San Antonio Spurs — 1970s (from the 1978-79 52-30 team-season page)
  const BBALL_STATS_SAS1970S = {
    "George Gervin|San Antonio|1970s": { ppg:29.6, rpg:5.0, apg:2.7, season:"1978-79" },
    "Larry Kenon|San Antonio|1970s": { ppg:22.1, rpg:9.8, apg:4.1, season:"1978-79" },
    "James Silas|San Antonio|1970s": { ppg:16.0, rpg:2.3, apg:3.5, season:"1978-79" },
    "Billy Paultz|San Antonio|1970s": { ppg:11.5, rpg:7.9, apg:2.3, season:"1978-79" },
    "Mark Olberding|San Antonio|1970s": { ppg:9.4, rpg:5.4, apg:2.6, season:"1978-79" },
    "Mike Gale|San Antonio|1970s": { ppg:8.0, rpg:2.3, apg:4.6, season:"1978-79" },
    "Coby Dietrick|San Antonio|1970s": { ppg:6.5, rpg:4.1, apg:2.6, season:"1978-79" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_SAS1970S);

  // Houston Rockets — 1970s (from the 1976-77 49-33 Central Division champion team)
  const BBALL_STATS_HOU1970S = {
    "Rudy Tomjanovich|Houston|1970s": { ppg:21.6, rpg:8.4, apg:2.1, season:"1976-77" },
    "Calvin Murphy|Houston|1970s": { ppg:17.9, rpg:2.1, apg:4.7, season:"1976-77" },
    "Moses Malone|Houston|1970s": { ppg:13.5, rpg:13.4, apg:1.1, season:"1976-77" },
    "Mike Newlin|Houston|1970s": { ppg:12.7, rpg:2.5, apg:3.9, season:"1976-77" },
    "Kevin Kunnert|Houston|1970s": { ppg:9.4, rpg:8.3, apg:1.9, season:"1976-77" },
    "John Johnson|Houston|1970s": { ppg:9.3, rpg:3.4, apg:2.1, season:"1976-77" },
    "Dwight Jones|Houston|1970s": { ppg:5.9, rpg:3.8, apg:0.6, season:"1976-77" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_HOU1970S);

  // Dallas Mavericks — 1980s (from the 1987-88 53-29 Western Conference Finals team)
  const BBALL_STATS_DAL1980S = {
    "Derek Harper|Dallas|1980s": { ppg:17.0, rpg:3.0, apg:7.7, season:"1987-88" },
    "Rolando Blackman|Dallas|1980s": { ppg:18.7, rpg:3.5, apg:3.7, season:"1987-88" },
    "Mark Aguirre|Dallas|1980s": { ppg:25.1, rpg:5.6, apg:3.6, season:"1987-88" },
    "Sam Perkins|Dallas|1980s": { ppg:14.2, rpg:8.0, apg:1.6, season:"1987-88" },
    "James Donaldson|Dallas|1980s": { ppg:7.0, rpg:9.3, apg:0.8, season:"1987-88" },
    "Roy Tarpley|Dallas|1980s": { ppg:13.5, rpg:11.8, apg:1.1, season:"1987-88" },
    "Brad Davis|Dallas|1980s": { ppg:7.2, rpg:1.4, apg:4.0, season:"1987-88" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_DAL1980S);

  // Houston Rockets — 1980s (from the 1985-86 51-31 "Twin Towers" NBA Finals team)
  const BBALL_STATS_HOU1980S = {
    "Hakeem Olajuwon|Houston|1980s": { ppg:23.5, rpg:11.5, apg:2.0, season:"1985-86" },
    "Ralph Sampson|Houston|1980s": { ppg:18.9, rpg:11.1, apg:3.6, season:"1985-86" },
    "John Lucas|Houston|1980s": { ppg:15.5, rpg:2.2, apg:8.8, season:"1985-86" },
    "Rodney McCray|Houston|1980s": { ppg:10.3, rpg:6.3, apg:3.6, season:"1985-86" },
    "Lewis Lloyd|Houston|1980s": { ppg:16.9, rpg:4.0, apg:3.7, season:"1985-86" },
    "Robert Reid|Houston|1980s": { ppg:12.0, rpg:3.7, apg:2.7, season:"1985-86" },
    "Jim Petersen|Houston|1980s": { ppg:6.2, rpg:4.8, apg:1.0, season:"1985-86" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_HOU1980S);

  // San Antonio Spurs — 1980s (from the 1982-83 53-29 Midwest Division champion team)
  const BBALL_STATS_SAS1980S = {
    "George Gervin|San Antonio|1980s": { ppg:26.2, rpg:4.6, apg:3.4, season:"1982-83" },
    "Mike Mitchell|San Antonio|1980s": { ppg:19.9, rpg:6.7, apg:1.2, season:"1982-83" },
    "Artis Gilmore|San Antonio|1980s": { ppg:18.0, rpg:12.0, apg:1.5, season:"1982-83" },
    "Johnny Moore|San Antonio|1980s": { ppg:12.2, rpg:3.6, apg:9.8, season:"1982-83" },
    "Gene Banks|San Antonio|1980s": { ppg:14.9, rpg:7.6, apg:3.4, season:"1982-83" },
    "Edgar Jones|San Antonio|1980s": { ppg:9.6, rpg:6.3, apg:0.7, season:"1982-83" },
    "Mike Dunleavy|San Antonio|1980s": { ppg:7.8, rpg:1.7, apg:5.5, season:"1982-83" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_SAS1980S);

  // Dallas Mavericks — 1990s (from the 1994-95 "Three J's + Kidd" team)
  const BBALL_STATS_DAL1990S = {
    "Jim Jackson|Dallas|1990s": { ppg:25.7, rpg:5.1, apg:3.7, season:"1994-95" },
    "Jamal Mashburn|Dallas|1990s": { ppg:24.1, rpg:4.1, apg:3.7, season:"1994-95" },
    "Jason Kidd|Dallas|1990s": { ppg:11.7, rpg:5.4, apg:7.7, season:"1994-95" },
    "Popeye Jones|Dallas|1990s": { ppg:10.3, rpg:10.6, apg:2.0, season:"1994-95" },
    "Roy Tarpley|Dallas|1990s": { ppg:12.6, rpg:8.2, apg:1.1, season:"1994-95" },
    "Lucious Harris|Dallas|1990s": { ppg:9.5, rpg:2.8, apg:1.7, season:"1994-95" },
    "Scott Brooks|Dallas|1990s": { ppg:7.9, rpg:1.7, apg:3.0, season:"1994-95" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_DAL1990S);

  // Houston Rockets — 1990s (from the 1993-94 58-24 NBA championship team)
  const BBALL_STATS_HOU1990S = {
    "Hakeem Olajuwon|Houston|1990s": { ppg:27.3, rpg:11.9, apg:3.6, season:"1993-94" },
    "Otis Thorpe|Houston|1990s": { ppg:14.0, rpg:10.6, apg:2.3, season:"1993-94" },
    "Vernon Maxwell|Houston|1990s": { ppg:13.6, rpg:3.1, apg:5.1, season:"1993-94" },
    "Robert Horry|Houston|1990s": { ppg:9.9, rpg:5.4, apg:2.9, season:"1993-94" },
    "Kenny Smith|Houston|1990s": { ppg:11.6, rpg:1.8, apg:4.2, season:"1993-94" },
    "Mario Elie|Houston|1990s": { ppg:9.3, rpg:2.7, apg:3.1, season:"1993-94" },
    "Sam Cassell|Houston|1990s": { ppg:6.7, rpg:2.0, apg:2.9, season:"1993-94" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_HOU1990S);

  // San Antonio Spurs — 1990s (from the 1994-95 62-20 MVP season, Robinson/Rodman era)
  const BBALL_STATS_SAS1990S = {
    "David Robinson|San Antonio|1990s": { ppg:27.6, rpg:10.8, apg:2.9, season:"1994-95" },
    "Sean Elliott|San Antonio|1990s": { ppg:18.1, rpg:3.5, apg:2.5, season:"1994-95" },
    "Avery Johnson|San Antonio|1990s": { ppg:13.4, rpg:2.5, apg:8.2, season:"1994-95" },
    "Dennis Rodman|San Antonio|1990s": { ppg:7.1, rpg:16.8, apg:2.0, season:"1994-95" },
    "Vinny Del Negro|San Antonio|1990s": { ppg:12.5, rpg:2.6, apg:3.0, season:"1994-95" },
    "Chuck Person|San Antonio|1990s": { ppg:10.8, rpg:3.2, apg:1.3, season:"1994-95" },
    "J.R. Reid|San Antonio|1990s": { ppg:7.0, rpg:4.9, apg:0.7, season:"1994-95" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_SAS1990S);

  // Memphis Grizzlies — 1990s (from the 1997-98 Vancouver Grizzlies team, Abdur-Rahim's real rookie year)
  const BBALL_STATS_MEM1990S = {
    "Shareef Abdur-Rahim|Memphis|1990s": { ppg:22.3, rpg:7.1, apg:2.6, season:"1997-98" },
    "Bryant Reeves|Memphis|1990s": { ppg:16.3, rpg:7.9, apg:2.1, season:"1997-98" },
    "Otis Thorpe|Memphis|1990s": { ppg:11.2, rpg:7.9, apg:3.4, season:"1997-98" },
    "Blue Edwards|Memphis|1990s": { ppg:10.8, rpg:2.7, apg:2.5, season:"1997-98" },
    "Antonio Daniels|Memphis|1990s": { ppg:7.8, rpg:1.9, apg:4.5, season:"1997-98" },
    "George Lynch|Memphis|1990s": { ppg:7.5, rpg:4.4, apg:1.5, season:"1997-98" },
    "Lee Mayberry|Memphis|1990s": { ppg:4.6, rpg:1.4, apg:4.4, season:"1997-98" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_MEM1990S);

  // Dallas Mavericks — 2000s (from the 2005-06 60-22 team that reached the NBA Finals)
  const BBALL_STATS_DAL2000S = {
    "Dirk Nowitzki|Dallas|2000s": { ppg:26.6, rpg:9.0, apg:2.8, season:"2005-06" },
    "Jason Terry|Dallas|2000s": { ppg:17.1, rpg:2.0, apg:3.8, season:"2005-06" },
    "Josh Howard|Dallas|2000s": { ppg:15.6, rpg:6.3, apg:1.9, season:"2005-06" },
    "Devin Harris|Dallas|2000s": { ppg:9.9, rpg:2.2, apg:3.2, season:"2005-06" },
    "Erick Dampier|Dallas|2000s": { ppg:5.7, rpg:7.8, apg:0.6, season:"2005-06" },
    "Jerry Stackhouse|Dallas|2000s": { ppg:13.0, rpg:2.8, apg:2.9, season:"2005-06" },
    "Marquis Daniels|Dallas|2000s": { ppg:10.2, rpg:3.6, apg:2.8, season:"2005-06" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_DAL2000S);

  // Houston Rockets — 2000s (from the 2007-08 55-27 team, 22-game win streak)
  const BBALL_STATS_HOU2000S = {
    "Yao Ming|Houston|2000s": { ppg:22.0, rpg:10.8, apg:2.3, season:"2007-08" },
    "Tracy McGrady|Houston|2000s": { ppg:21.6, rpg:5.1, apg:5.9, season:"2007-08" },
    "Shane Battier|Houston|2000s": { ppg:9.3, rpg:5.1, apg:1.9, season:"2007-08" },
    "Rafer Alston|Houston|2000s": { ppg:13.1, rpg:3.5, apg:5.3, season:"2007-08" },
    "Luis Scola|Houston|2000s": { ppg:10.3, rpg:6.4, apg:1.3, season:"2007-08" },
    "Bonzi Wells|Houston|2000s": { ppg:9.2, rpg:5.1, apg:1.6, season:"2007-08" },
    "Chuck Hayes|Houston|2000s": { ppg:3.0, rpg:5.4, apg:1.2, season:"2007-08" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_HOU2000S);

  // San Antonio Spurs — 2000s (from the 2004-05 59-23 NBA champion team)
  const BBALL_STATS_SAS2000S = {
    "Tim Duncan|San Antonio|2000s": { ppg:20.3, rpg:11.1, apg:2.7, season:"2004-05" },
    "Tony Parker|San Antonio|2000s": { ppg:16.6, rpg:3.7, apg:6.1, season:"2004-05" },
    "Manu Ginóbili|San Antonio|2000s": { ppg:16.0, rpg:4.4, apg:3.9, season:"2004-05" },
    "Bruce Bowen|San Antonio|2000s": { ppg:8.2, rpg:3.5, apg:1.5, season:"2004-05" },
    "Rasho Nesterović|San Antonio|2000s": { ppg:5.9, rpg:6.6, apg:1.0, season:"2004-05" },
    "Brent Barry|San Antonio|2000s": { ppg:7.4, rpg:2.3, apg:2.2, season:"2004-05" },
    "Robert Horry|San Antonio|2000s": { ppg:6.0, rpg:3.6, apg:1.1, season:"2004-05" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_SAS2000S);

  // Memphis Grizzlies — 2000s (from the 2005-06 49-33 team)
  const BBALL_STATS_MEM2000S = {
    "Pau Gasol|Memphis|2000s": { ppg:20.4, rpg:8.9, apg:4.6, season:"2005-06" },
    "Shane Battier|Memphis|2000s": { ppg:10.1, rpg:5.3, apg:1.7, season:"2005-06" },
    "Eddie Jones|Memphis|2000s": { ppg:11.8, rpg:3.7, apg:2.4, season:"2005-06" },
    "Damon Stoudamire|Memphis|2000s": { ppg:11.7, rpg:3.5, apg:4.7, season:"2005-06" },
    "Mike Miller|Memphis|2000s": { ppg:13.7, rpg:5.4, apg:2.7, season:"2005-06" },
    "Bobby Jackson|Memphis|2000s": { ppg:11.4, rpg:3.1, apg:2.7, season:"2005-06" },
    "Lorenzen Wright|Memphis|2000s": { ppg:5.8, rpg:5.1, apg:0.6, season:"2005-06" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_MEM2000S);

  // New Orleans Hornets — 2000s (from the 2007-08 56-26 franchise-record team)
  const BBALL_STATS_NOP2000S = {
    "Chris Paul|New Orleans|2000s": { ppg:21.1, rpg:4.0, apg:11.6, season:"2007-08" },
    "David West|New Orleans|2000s": { ppg:20.6, rpg:8.9, apg:2.3, season:"2007-08" },
    "Tyson Chandler|New Orleans|2000s": { ppg:11.8, rpg:11.7, apg:1.0, season:"2007-08" },
    "Peja Stojaković|New Orleans|2000s": { ppg:16.4, rpg:4.3, apg:1.2, season:"2007-08" },
    "Morris Peterson|New Orleans|2000s": { ppg:8.0, rpg:2.7, apg:0.9, season:"2007-08" },
    "Bobby Jackson|New Orleans|2000s": { ppg:7.1, rpg:2.4, apg:1.7, season:"2007-08" },
    "Jannero Pargo|New Orleans|2000s": { ppg:8.1, rpg:1.6, apg:2.4, season:"2007-08" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_NOP2000S);

  // Dallas Mavericks — 2010s (from the 2010-11 57-25 NBA championship team)
  const BBALL_STATS_DAL2010S = {
    "Dirk Nowitzki|Dallas|2010s": { ppg:23.0, rpg:7.0, apg:2.6, season:"2010-11" },
    "Jason Kidd|Dallas|2010s": { ppg:7.9, rpg:4.4, apg:8.2, season:"2010-11" },
    "Jason Terry|Dallas|2010s": { ppg:15.8, rpg:1.9, apg:4.1, season:"2010-11" },
    "Shawn Marion|Dallas|2010s": { ppg:12.5, rpg:6.9, apg:1.4, season:"2010-11" },
    "Tyson Chandler|Dallas|2010s": { ppg:10.1, rpg:9.4, apg:0.4, season:"2010-11" },
    "J.J. Barea|Dallas|2010s": { ppg:9.5, rpg:2.0, apg:3.9, season:"2010-11" },
    "DeShawn Stevenson|Dallas|2010s": { ppg:5.3, rpg:1.5, apg:1.1, season:"2010-11" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_DAL2010S);

  // Houston Rockets — 2010s (from the 2017-18 65-17 league-best team, Harden's MVP season)
  const BBALL_STATS_HOU2010S = {
    "James Harden|Houston|2010s": { ppg:30.4, rpg:5.4, apg:8.8, season:"2017-18" },
    "Chris Paul|Houston|2010s": { ppg:18.6, rpg:5.4, apg:7.9, season:"2017-18" },
    "Trevor Ariza|Houston|2010s": { ppg:11.7, rpg:4.4, apg:1.6, season:"2017-18" },
    "Clint Capela|Houston|2010s": { ppg:13.9, rpg:10.8, apg:0.9, season:"2017-18" },
    "P.J. Tucker|Houston|2010s": { ppg:6.1, rpg:5.6, apg:0.9, season:"2017-18" },
    "Eric Gordon|Houston|2010s": { ppg:18.0, rpg:2.5, apg:2.2, season:"2017-18" },
    "Ryan Anderson|Houston|2010s": { ppg:9.3, rpg:5.0, apg:0.9, season:"2017-18" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_HOU2010S);

  // San Antonio Spurs — 2010s (from the 2013-14 62-20 NBA championship team)
  const BBALL_STATS_SAS2010S = {
    "Tony Parker|San Antonio|2010s": { ppg:16.7, rpg:2.3, apg:5.7, season:"2013-14" },
    "Tim Duncan|San Antonio|2010s": { ppg:15.1, rpg:9.7, apg:3.0, season:"2013-14" },
    "Kawhi Leonard|San Antonio|2010s": { ppg:12.8, rpg:6.2, apg:2.0, season:"2013-14" },
    "Danny Green|San Antonio|2010s": { ppg:9.1, rpg:3.4, apg:1.5, season:"2013-14" },
    "Tiago Splitter|San Antonio|2010s": { ppg:8.2, rpg:6.2, apg:1.5, season:"2013-14" },
    "Manu Ginóbili|San Antonio|2010s": { ppg:12.3, rpg:3.0, apg:4.3, season:"2013-14" },
    "Boris Diaw|San Antonio|2010s": { ppg:9.1, rpg:4.1, apg:2.8, season:"2013-14" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_SAS2010S);

  // Memphis Grizzlies — 2010s (from the 2012-13 56-26 "Grit and Grind" WCF team)
  const BBALL_STATS_MEM2010S = {
    "Marc Gasol|Memphis|2010s": { ppg:14.1, rpg:7.8, apg:4.0, season:"2012-13" },
    "Mike Conley|Memphis|2010s": { ppg:14.6, rpg:2.8, apg:6.1, season:"2012-13" },
    "Zach Randolph|Memphis|2010s": { ppg:15.4, rpg:11.2, apg:1.4, season:"2012-13" },
    "Tayshaun Prince|Memphis|2010s": { ppg:8.8, rpg:4.2, apg:2.3, season:"2012-13" },
    "Tony Allen|Memphis|2010s": { ppg:8.9, rpg:4.6, apg:1.2, season:"2012-13" },
    "Jerryd Bayless|Memphis|2010s": { ppg:8.7, rpg:2.2, apg:3.3, season:"2012-13" },
    "Darrell Arthur|Memphis|2010s": { ppg:6.1, rpg:2.9, apg:0.6, season:"2012-13" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_MEM2010S);

  // New Orleans Pelicans — 2010s (from the 2017-18 48-34 team, Davis's real MVP-caliber season)
  const BBALL_STATS_NOP2010S = {
    "Anthony Davis|New Orleans|2010s": { ppg:28.1, rpg:11.1, apg:2.3, season:"2017-18" },
    "DeMarcus Cousins|New Orleans|2010s": { ppg:25.2, rpg:12.9, apg:5.4, season:"2017-18" },
    "Jrue Holiday|New Orleans|2010s": { ppg:19.0, rpg:4.5, apg:6.0, season:"2017-18" },
    "E'Twaun Moore|New Orleans|2010s": { ppg:12.5, rpg:2.9, apg:2.3, season:"2017-18" },
    "Rajon Rondo|New Orleans|2010s": { ppg:8.3, rpg:4.0, apg:8.2, season:"2017-18" },
    "Nikola Mirotić|New Orleans|2010s": { ppg:14.6, rpg:8.2, apg:1.4, season:"2017-18" },
    "Darius Miller|New Orleans|2010s": { ppg:7.8, rpg:2.0, apg:1.4, season:"2017-18" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_NOP2010S);

  // Dallas Mavericks — 2020s (from the 2023-24 50-32 team that reached the NBA Finals)
  const BBALL_STATS_DAL2020S = {
    "Luka Dončić|Dallas|2020s": { ppg:33.9, rpg:9.2, apg:9.8, season:"2023-24" },
    "Kyrie Irving|Dallas|2020s": { ppg:25.6, rpg:5.0, apg:5.2, season:"2023-24" },
    "P.J. Washington|Dallas|2020s": { ppg:11.7, rpg:6.2, apg:1.5, season:"2023-24" },
    "Daniel Gafford|Dallas|2020s": { ppg:11.2, rpg:6.9, apg:1.6, season:"2023-24" },
    "Derrick Jones Jr.|Dallas|2020s": { ppg:8.6, rpg:3.3, apg:1.0, season:"2023-24" },
    "Tim Hardaway Jr.|Dallas|2020s": { ppg:14.4, rpg:3.2, apg:1.8, season:"2023-24" },
    "Dereck Lively II|Dallas|2020s": { ppg:8.8, rpg:6.9, apg:1.1, season:"2023-24" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_DAL2020S);

  // Houston Rockets — 2020s (from the 2023-24 41-41 young-core team)
  const BBALL_STATS_HOU2020S = {
    "Fred VanVleet|Houston|2020s": { ppg:17.4, rpg:3.8, apg:8.1, season:"2023-24" },
    "Alperen Şengün|Houston|2020s": { ppg:21.1, rpg:9.3, apg:5.0, season:"2023-24" },
    "Jabari Smith Jr.|Houston|2020s": { ppg:13.7, rpg:8.1, apg:1.6, season:"2023-24" },
    "Jalen Green|Houston|2020s": { ppg:19.6, rpg:5.2, apg:3.5, season:"2023-24" },
    "Dillon Brooks|Houston|2020s": { ppg:12.7, rpg:3.4, apg:1.7, season:"2023-24" },
    "Amen Thompson|Houston|2020s": { ppg:9.5, rpg:6.6, apg:2.6, season:"2023-24" },
    "Tari Eason|Houston|2020s": { ppg:9.8, rpg:7.0, apg:1.2, season:"2023-24" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_HOU2020S);

  // San Antonio Spurs — 2020s (from the 2023-24 22-60 team, Wembanyama's real unanimous ROY season)
  const BBALL_STATS_SAS2020S = {
    "Victor Wembanyama|San Antonio|2020s": { ppg:21.4, rpg:10.6, apg:3.9, season:"2023-24" },
    "Devin Vassell|San Antonio|2020s": { ppg:19.5, rpg:3.8, apg:4.1, season:"2023-24" },
    "Keldon Johnson|San Antonio|2020s": { ppg:15.7, rpg:5.5, apg:2.8, season:"2023-24" },
    "Jeremy Sochan|San Antonio|2020s": { ppg:11.6, rpg:6.4, apg:3.4, season:"2023-24" },
    "Tre Jones|San Antonio|2020s": { ppg:10.0, rpg:3.8, apg:6.2, season:"2023-24" },
    "Zach Collins|San Antonio|2020s": { ppg:11.2, rpg:5.4, apg:2.8, season:"2023-24" },
    "Malaki Branham|San Antonio|2020s": { ppg:9.2, rpg:2.0, apg:2.1, season:"2023-24" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_SAS2020S);

  // Memphis Grizzlies — 2020s (from the 2021-22 56-26 Southwest Division champion team)
  const BBALL_STATS_MEM2020S = {
    "Ja Morant|Memphis|2020s": { ppg:27.4, rpg:5.7, apg:6.7, season:"2021-22" },
    "Desmond Bane|Memphis|2020s": { ppg:18.2, rpg:4.4, apg:2.7, season:"2021-22" },
    "Dillon Brooks|Memphis|2020s": { ppg:18.4, rpg:3.2, apg:2.8, season:"2021-22" },
    "Jaren Jackson Jr.|Memphis|2020s": { ppg:16.3, rpg:5.8, apg:1.1, season:"2021-22" },
    "Steven Adams|Memphis|2020s": { ppg:6.9, rpg:10.0, apg:3.4, season:"2021-22" },
    "Tyus Jones|Memphis|2020s": { ppg:8.7, rpg:2.4, apg:4.4, season:"2021-22" },
    "Brandon Clarke|Memphis|2020s": { ppg:10.4, rpg:5.3, apg:1.3, season:"2021-22" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_MEM2020S);

  // New Orleans Pelicans — 2020s (from the 2022-23 42-40 team)
  const BBALL_STATS_NOP2020S = {
    "CJ McCollum|New Orleans|2020s": { ppg:20.9, rpg:4.4, apg:5.7, season:"2022-23" },
    "Brandon Ingram|New Orleans|2020s": { ppg:24.7, rpg:5.5, apg:5.8, season:"2022-23" },
    "Zion Williamson|New Orleans|2020s": { ppg:26.0, rpg:7.0, apg:4.6, season:"2022-23" },
    "Jonas Valančiūnas|New Orleans|2020s": { ppg:14.1, rpg:10.2, apg:1.8, season:"2022-23" },
    "Jose Alvarado|New Orleans|2020s": { ppg:9.0, rpg:2.3, apg:3.0, season:"2022-23" },
    "Trey Murphy III|New Orleans|2020s": { ppg:14.5, rpg:3.6, apg:1.4, season:"2022-23" },
    "Herbert Jones|New Orleans|2020s": { ppg:9.8, rpg:4.1, apg:2.5, season:"2022-23" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_NOP2020S);

  // Chicago Bulls — 1990s, first three-peat era (from the 1991-92 67-15 championship team)
  const BBALL_STATS_CHI1990S_A = {
    "Michael Jordan|Chicago|1990s": { ppg:30.1, rpg:6.4, apg:6.1, season:"1991-92" },
    "Scottie Pippen|Chicago|1990s": { ppg:21.0, rpg:7.7, apg:7.0, season:"1991-92" },
    "Horace Grant|Chicago|1990s": { ppg:14.2, rpg:10.0, apg:2.7, season:"1991-92" },
    "John Paxson|Chicago|1990s": { ppg:7.0, rpg:1.2, apg:3.1, season:"1991-92" },
    "Bill Cartwright|Chicago|1990s": { ppg:8.0, rpg:5.1, apg:1.4, season:"1991-92" },
    "B.J. Armstrong|Chicago|1990s": { ppg:9.9, rpg:1.8, apg:3.2, season:"1991-92" },
    "Stacey King|Chicago|1990s": { ppg:7.0, rpg:2.6, apg:1.0, season:"1991-92" },
    "Will Perdue|Chicago|1990s": { ppg:4.5, rpg:4.1, apg:1.0, season:"1991-92" },
    "Craig Hodges|Chicago|1990s": { ppg:4.3, rpg:0.4, apg:1.0, season:"1991-92" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_CHI1990S_A);

  // Chicago Bulls — 1990s, second three-peat era (from the 1995-96 72-10 record-setting championship team)
  const BBALL_STATS_CHI1990S_B = {
    "Ron Harper|Chicago|1990s": { ppg:7.4, rpg:2.7, apg:2.6, season:"1995-96" },
    "Steve Kerr|Chicago|1990s": { ppg:8.4, rpg:1.3, apg:2.3, season:"1995-96" },
    "Toni Kukoč|Chicago|1990s": { ppg:13.1, rpg:4.0, apg:3.5, season:"1995-96" },
    "Dennis Rodman|Chicago|1990s": { ppg:5.5, rpg:14.9, apg:2.5, season:"1995-96" },
    "Jud Buechler|Chicago|1990s": { ppg:3.8, rpg:1.5, apg:0.8, season:"1995-96" },
    "Luc Longley|Chicago|1990s": { ppg:9.1, rpg:5.1, apg:1.9, season:"1995-96" },
    "Randy Brown|Chicago|1990s": { ppg:2.7, rpg:1.0, apg:1.1, season:"1995-96" },
    "Bill Wennington|Chicago|1990s": { ppg:5.3, rpg:2.5, apg:0.6, season:"1995-96" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_CHI1990S_B);

  // Chicago Bulls — 1970s (from the 1974-75 47-35 Central Division champion team)
  const BBALL_STATS_CHI1970S = {
    "Bob Love|Chicago|1970s": { ppg:22.0, rpg:6.3, apg:1.7, season:"1974-75" },
    "Chet Walker|Chicago|1970s": { ppg:19.2, rpg:5.7, apg:2.2, season:"1974-75" },
    "Norm Van Lier|Chicago|1970s": { ppg:15.0, rpg:4.7, apg:5.8, season:"1974-75" },
    "Jerry Sloan|Chicago|1970s": { ppg:12.2, rpg:6.9, apg:2.1, season:"1974-75" },
    "Nate Thurmond|Chicago|1970s": { ppg:7.9, rpg:11.3, apg:4.1, season:"1974-75" },
    "Matt Guokas|Chicago|1970s": { ppg:7.2, rpg:1.7, apg:2.2, season:"1974-75" },
    "Tom Boerwinkle|Chicago|1970s": { ppg:4.2, rpg:4.8, apg:3.4, season:"1974-75" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_CHI1970S);

  // Cleveland Cavaliers — 1970s (from the 1975-76 49-33 "Miracle of Richfield" Central Division champion team)
  const BBALL_STATS_CLE1970S = {
    "Jim Chones|Cleveland|1970s": { ppg:15.8, rpg:9.0, apg:2.0, season:"1975-76" },
    "Campy Russell|Cleveland|1970s": { ppg:15.0, rpg:4.2, apg:1.3, season:"1975-76" },
    "Bingo Smith|Cleveland|1970s": { ppg:13.6, rpg:4.2, apg:1.9, season:"1975-76" },
    "Dick Snyder|Cleveland|1970s": { ppg:12.6, rpg:2.4, apg:2.7, season:"1975-76" },
    "Jim Cleamons|Cleveland|1970s": { ppg:12.2, rpg:4.3, apg:5.2, season:"1975-76" },
    "Jim Brewer|Cleveland|1970s": { ppg:11.5, rpg:10.9, apg:2.5, season:"1975-76" },
    "Austin Carr|Cleveland|1970s": { ppg:10.1, rpg:2.0, apg:1.9, season:"1975-76" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_CLE1970S);

  // Detroit Pistons — 1970s (from the 1973-74 52-30 conference semifinal team)
  const BBALL_STATS_DET1970S = {
    "Bob Lanier|Detroit|1970s": { ppg:22.5, rpg:13.3, apg:4.5, season:"1973-74" },
    "Dave Bing|Detroit|1970s": { ppg:18.8, rpg:3.3, apg:6.9, season:"1973-74" },
    "Curtis Rowe|Detroit|1970s": { ppg:15.5, rpg:8.0, apg:2.0, season:"1973-74" },
    "Chris Ford|Detroit|1970s": { ppg:11.0, rpg:3.7, apg:3.8, season:"1973-74" },
    "Don Adams|Detroit|1970s": { ppg:10.0, rpg:6.5, apg:1.8, season:"1973-74" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_DET1970S);

  // Indiana Pacers — 1970s (from the 1976-77 36-46 team, Indiana's first NBA season)
  const BBALL_STATS_IND1970S = {
    "Billy Knight|Indiana|1970s": { ppg:26.6, rpg:7.0, apg:3.0, season:"1976-77" },
    "Don Buse|Indiana|1970s": { ppg:8.0, rpg:4.0, apg:8.5, season:"1976-77" },
    "Darnell Hillman|Indiana|1970s": { ppg:13.5, rpg:8.7, apg:1.5, season:"1976-77" },
    "Dave Robisch|Indiana|1970s": { ppg:12.0, rpg:8.0, apg:2.0, season:"1976-77" },
    "John Williamson|Indiana|1970s": { ppg:15.0, rpg:2.5, apg:2.5, season:"1976-77" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_IND1970S);

  // Milwaukee Bucks — 1970s (from the 1970-71 66-16 NBA championship team)
  const BBALL_STATS_MIL1970S = {
    "Kareem Abdul-Jabbar|Milwaukee|1970s": { ppg:31.7, rpg:16.0, apg:3.3, season:"1970-71" },
    "Oscar Robertson|Milwaukee|1970s": { ppg:19.4, rpg:5.7, apg:8.2, season:"1970-71" },
    "Bob Dandridge|Milwaukee|1970s": { ppg:18.4, rpg:8.0, apg:3.5, season:"1970-71" },
    "Jon McGlocklin|Milwaukee|1970s": { ppg:15.8, rpg:2.7, apg:3.7, season:"1970-71" },
    "Greg Smith|Milwaukee|1970s": { ppg:11.7, rpg:7.2, apg:2.8, season:"1970-71" },
    "Bob Boozer|Milwaukee|1970s": { ppg:9.1, rpg:5.4, apg:1.6, season:"1970-71" },
    "Lucius Allen|Milwaukee|1970s": { ppg:7.1, rpg:2.5, apg:2.6, season:"1970-71" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_MIL1970S);

  // Washington Bullets — 1970s (from the 1977-78 44-38 NBA championship team)
  const BBALL_STATS_WAS1970S = {
    "Elvin Hayes|Washington|1970s": { ppg:19.7, rpg:13.3, apg:1.9, season:"1977-78" },
    "Bob Dandridge|Washington|1970s": { ppg:19.0, rpg:6.0, apg:4.0, season:"1977-78" },
    "Wes Unseld|Washington|1970s": { ppg:9.0, rpg:12.0, apg:3.5, season:"1977-78" },
    "Kevin Grevey|Washington|1970s": { ppg:15.5, rpg:3.0, apg:2.0, season:"1977-78" },
    "Tom Henderson|Washington|1970s": { ppg:11.4, rpg:3.0, apg:5.4, season:"1977-78" },
    "Mitch Kupchak|Washington|1970s": { ppg:16.0, rpg:7.0, apg:1.5, season:"1977-78" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_WAS1970S);

  // Washington Bullets — 1980s (from the 1981-82 43-39 team)
  const BBALL_STATS_WAS1980S = {
    "Greg Ballard|Washington|1980s": { ppg:18.0, rpg:6.0, apg:2.5, season:"1981-82" },
    "Jeff Ruland|Washington|1980s": { ppg:13.0, rpg:9.3, apg:1.5, season:"1981-82" },
    "John Lucas|Washington|1980s": { ppg:13.0, rpg:3.0, apg:6.7, season:"1981-82" },
    "Kevin Grevey|Washington|1980s": { ppg:13.3, rpg:3.0, apg:2.0, season:"1981-82" },
    "Rick Mahorn|Washington|1980s": { ppg:7.5, rpg:6.5, apg:1.0, season:"1981-82" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_WAS1980S);

  // Washington Bullets — 1990s (from the 1996-97 44-38 team)
  const BBALL_STATS_WAS1990S = {
    "Juwan Howard|Washington|1990s": { ppg:19.1, rpg:8.0, apg:3.8, season:"1996-97" },
    "Chris Webber|Washington|1990s": { ppg:20.1, rpg:10.3, apg:4.6, season:"1996-97" },
    "Rod Strickland|Washington|1990s": { ppg:17.2, rpg:4.9, apg:8.9, season:"1996-97" },
    "Calbert Cheaney|Washington|1990s": { ppg:10.6, rpg:3.4, apg:1.4, season:"1996-97" },
    "Tracy Murray|Washington|1990s": { ppg:11.8, rpg:2.9, apg:0.8, season:"1996-97" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_WAS1990S);

  // Washington Wizards — 2000s (from the 2005-06 42-40 team)
  const BBALL_STATS_WAS2000S = {
    "Gilbert Arenas|Washington|2000s": { ppg:29.3, rpg:4.9, apg:6.1, season:"2005-06" },
    "Antawn Jamison|Washington|2000s": { ppg:20.5, rpg:9.3, apg:2.0, season:"2005-06" },
    "Caron Butler|Washington|2000s": { ppg:17.0, rpg:6.0, apg:3.5, season:"2005-06" },
    "Brendan Haywood|Washington|2000s": { ppg:10.0, rpg:7.6, apg:1.0, season:"2005-06" },
    "DeShawn Stevenson|Washington|2000s": { ppg:8.0, rpg:3.0, apg:2.0, season:"2005-06" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_WAS2000S);

  // Washington Wizards — 2010s (from the 2016-17 49-33 team, deepest playoff run since 2010)
  const BBALL_STATS_WAS2010S = {
    "John Wall|Washington|2010s": { ppg:23.1, rpg:4.2, apg:10.7, season:"2016-17" },
    "Bradley Beal|Washington|2010s": { ppg:23.1, rpg:3.5, apg:3.5, season:"2016-17" },
    "Otto Porter Jr.|Washington|2010s": { ppg:13.4, rpg:6.4, apg:1.5, season:"2016-17" },
    "Marcin Gortat|Washington|2010s": { ppg:11.1, rpg:10.4, apg:1.4, season:"2016-17" },
    "Markieff Morris|Washington|2010s": { ppg:14.0, rpg:6.5, apg:1.8, season:"2016-17" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_WAS2010S);

  // Washington Wizards — 2020s (from the 2020-21 34-38 play-in team, Westbrook's real triple-double season)
  const BBALL_STATS_WAS2020S = {
    "Bradley Beal|Washington|2020s": { ppg:31.3, rpg:4.2, apg:4.4, season:"2020-21" },
    "Russell Westbrook|Washington|2020s": { ppg:22.2, rpg:11.5, apg:11.7, season:"2020-21" },
    "Rui Hachimura|Washington|2020s": { ppg:13.8, rpg:5.5, apg:1.8, season:"2020-21" },
    "Davis Bertans|Washington|2020s": { ppg:15.4, rpg:4.5, apg:1.7, season:"2020-21" },
    "Thomas Bryant|Washington|2020s": { ppg:13.2, rpg:7.2, apg:1.1, season:"2020-21" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_WAS2020S);

  // Milwaukee Bucks — 1980s (from the 1983-84 51-31 Eastern Conference Finals team)
  const BBALL_STATS_MIL1980S = {
    "Sidney Moncrief|Milwaukee|1980s": { ppg:20.2, rpg:5.3, apg:4.4, season:"1983-84" },
    "Marques Johnson|Milwaukee|1980s": { ppg:17.7, rpg:6.9, apg:3.7, season:"1983-84" },
    "Junior Bridgeman|Milwaukee|1980s": { ppg:13.9, rpg:3.5, apg:2.4, season:"1983-84" },
    "Bob Lanier|Milwaukee|1980s": { ppg:10.5, rpg:6.9, apg:2.6, season:"1983-84" },
    "Alton Lister|Milwaukee|1980s": { ppg:7.9, rpg:7.4, apg:0.9, season:"1983-84" },
    "Paul Pressey|Milwaukee|1980s": { ppg:10.4, rpg:4.4, apg:4.3, season:"1983-84" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_MIL1980S);

  // Milwaukee Bucks — 1990s (from the 1998-99 lockout-shortened team, Big Three forming)
  const BBALL_STATS_MIL1990S = {
    "Glenn Robinson|Milwaukee|1990s": { ppg:18.4, rpg:5.9, apg:2.1, season:"1998-99" },
    "Ray Allen|Milwaukee|1990s": { ppg:17.1, rpg:4.2, apg:3.6, season:"1998-99" },
    "Terrell Brandon|Milwaukee|1990s": { ppg:15.6, rpg:2.9, apg:7.1, season:"1998-99" },
    "Ervin Johnson|Milwaukee|1990s": { ppg:6.0, rpg:6.4, apg:0.5, season:"1998-99" },
    "Tim Thomas|Milwaukee|1990s": { ppg:11.0, rpg:4.5, apg:1.5, season:"1998-99" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_MIL1990S);

  // Milwaukee Bucks — 2000s (from the 2000-01 52-30 Eastern Conference Finals team)
  const BBALL_STATS_MIL2000S = {
    "Ray Allen|Milwaukee|2000s": { ppg:22.0, rpg:5.2, apg:4.6, season:"2000-01" },
    "Glenn Robinson|Milwaukee|2000s": { ppg:22.0, rpg:6.9, apg:3.3, season:"2000-01" },
    "Sam Cassell|Milwaukee|2000s": { ppg:18.2, rpg:3.8, apg:7.6, season:"2000-01" },
    "Tim Thomas|Milwaukee|2000s": { ppg:12.6, rpg:4.4, apg:1.8, season:"2000-01" },
    "Ervin Johnson|Milwaukee|2000s": { ppg:5.6, rpg:7.5, apg:0.7, season:"2000-01" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_MIL2000S);

  // Milwaukee Bucks — 2010s (from the 2018-19 60-22 team, Giannis's real MVP season)
  const BBALL_STATS_MIL2010S = {
    "Giannis Antetokounmpo|Milwaukee|2010s": { ppg:27.7, rpg:12.5, apg:5.9, season:"2018-19" },
    "Khris Middleton|Milwaukee|2010s": { ppg:18.3, rpg:6.0, apg:4.3, season:"2018-19" },
    "Eric Bledsoe|Milwaukee|2010s": { ppg:15.9, rpg:4.6, apg:5.5, season:"2018-19" },
    "Brook Lopez|Milwaukee|2010s": { ppg:12.5, rpg:4.9, apg:1.5, season:"2018-19" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_MIL2010S);

  // Milwaukee Bucks — 2020s (from the 2020-21 46-26 NBA championship team, Giannis's real Finals MVP run)
  const BBALL_STATS_MIL2020S = {
    "Giannis Antetokounmpo|Milwaukee|2020s": { ppg:28.1, rpg:11.0, apg:5.9, season:"2020-21" },
    "Khris Middleton|Milwaukee|2020s": { ppg:20.4, rpg:6.0, apg:5.4, season:"2020-21" },
    "Jrue Holiday|Milwaukee|2020s": { ppg:17.7, rpg:5.0, apg:7.1, season:"2020-21" },
    "Brook Lopez|Milwaukee|2020s": { ppg:12.3, rpg:4.7, apg:1.3, season:"2020-21" },
    "Bobby Portis|Milwaukee|2020s": { ppg:9.2, rpg:7.0, apg:1.0, season:"2020-21" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_MIL2020S);

  // Indiana Pacers — 1980s (from the 1988-89 28-54 team — rookie Reggie Miller & Rik Smits)
  const BBALL_STATS_IND1980S = {
    "Chuck Person|Indiana|1980s": { ppg:21.6, rpg:6.5, apg:3.6, season:"1988-89" },
    "Reggie Miller|Indiana|1980s": { ppg:16.0, rpg:2.7, apg:2.3, season:"1988-89" },
    "Vern Fleming|Indiana|1980s": { ppg:14.3, rpg:3.3, apg:6.5, season:"1988-89" },
    "Detlef Schrempf|Indiana|1980s": { ppg:14.8, rpg:7.2, apg:3.6, season:"1988-89" },
    "Rik Smits|Indiana|1980s": { ppg:11.7, rpg:6.1, apg:0.9, season:"1988-89" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_IND1980S);

  // Indiana Pacers — 1990s (from the 1997-98 58-24 franchise-record Eastern Conference Finals team)
  const BBALL_STATS_IND1990S = {
    "Reggie Miller|Indiana|1990s": { ppg:19.5, rpg:3.1, apg:3.2, season:"1997-98" },
    "Rik Smits|Indiana|1990s": { ppg:16.7, rpg:6.9, apg:1.4, season:"1997-98" },
    "Mark Jackson|Indiana|1990s": { ppg:9.0, rpg:4.5, apg:8.7, season:"1997-98" },
    "Dale Davis|Indiana|1990s": { ppg:8.5, rpg:7.5, apg:1.0, season:"1997-98" },
    "Chris Mullin|Indiana|1990s": { ppg:11.5, rpg:3.0, apg:2.5, season:"1997-98" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_IND1990S);

  // Indiana Pacers — 2000s (from the 2003-04 61-21 Central Division champion team)
  const BBALL_STATS_IND2000S = {
    "Jermaine O'Neal|Indiana|2000s": { ppg:20.1, rpg:10.0, apg:2.1, season:"2003-04" },
    "Ron Artest|Indiana|2000s": { ppg:18.3, rpg:5.3, apg:3.5, season:"2003-04" },
    "Al Harrington|Indiana|2000s": { ppg:13.3, rpg:5.6, apg:1.7, season:"2003-04" },
    "Reggie Miller|Indiana|2000s": { ppg:14.8, rpg:2.4, apg:2.5, season:"2003-04" },
    "Jamaal Tinsley|Indiana|2000s": { ppg:11.3, rpg:3.6, apg:6.6, season:"2003-04" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_IND2000S);

  // Indiana Pacers — 2010s (from the 2013-14 56-26 Central Division champion, Eastern Conference Finals team)
  const BBALL_STATS_IND2010S = {
    "Paul George|Indiana|2010s": { ppg:21.7, rpg:6.2, apg:3.5, season:"2013-14" },
    "Roy Hibbert|Indiana|2010s": { ppg:10.6, rpg:6.6, apg:1.4, season:"2013-14" },
    "David West|Indiana|2010s": { ppg:14.0, rpg:6.8, apg:2.6, season:"2013-14" },
    "Lance Stephenson|Indiana|2010s": { ppg:13.8, rpg:7.2, apg:4.6, season:"2013-14" },
    "George Hill|Indiana|2010s": { ppg:10.3, rpg:2.9, apg:3.5, season:"2013-14" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_IND2010S);

  // Indiana Pacers — 2020s (from the 2024-25 50-32 team that reached the NBA Finals)
  const BBALL_STATS_IND2020S = {
    "Tyrese Haliburton|Indiana|2020s": { ppg:18.6, rpg:3.5, apg:9.2, season:"2024-25" },
    "Pascal Siakam|Indiana|2020s": { ppg:20.2, rpg:6.9, apg:3.4, season:"2024-25" },
    "Myles Turner|Indiana|2020s": { ppg:15.6, rpg:6.5, apg:1.3, season:"2024-25" },
    "Aaron Nesmith|Indiana|2020s": { ppg:12.0, rpg:3.6, apg:1.5, season:"2024-25" },
    "Andrew Nembhard|Indiana|2020s": { ppg:10.0, rpg:2.9, apg:4.7, season:"2024-25" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_IND2020S);

  // Detroit Pistons — 1980s (from the 1988-89 63-19 "Bad Boys" NBA championship team)
  const BBALL_STATS_DET1980S = {
    "Isiah Thomas|Detroit|1980s": { ppg:18.2, rpg:3.4, apg:8.3, season:"1988-89" },
    "Joe Dumars|Detroit|1980s": { ppg:17.2, rpg:2.5, apg:5.7, season:"1988-89" },
    "Bill Laimbeer|Detroit|1980s": { ppg:14.0, rpg:10.0, apg:2.0, season:"1988-89" },
    "Dennis Rodman|Detroit|1980s": { ppg:9.4, rpg:9.4, apg:1.4, season:"1988-89" },
    "Rick Mahorn|Detroit|1980s": { ppg:8.7, rpg:6.9, apg:1.6, season:"1988-89" },
    "Vinnie Johnson|Detroit|1980s": { ppg:13.7, rpg:2.2, apg:2.6, season:"1988-89" },
    "James Edwards|Detroit|1980s": { ppg:11.7, rpg:3.4, apg:1.1, season:"1988-89" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_DET1980S);

  // Detroit Pistons — 1990s (from the 1989-90 59-23 back-to-back NBA championship team)
  const BBALL_STATS_DET1990S = {
    "Isiah Thomas|Detroit|1990s": { ppg:18.4, rpg:3.0, apg:9.4, season:"1989-90" },
    "Joe Dumars|Detroit|1990s": { ppg:17.8, rpg:2.6, apg:4.9, season:"1989-90" },
    "Mark Aguirre|Detroit|1990s": { ppg:14.1, rpg:4.6, apg:2.1, season:"1989-90" },
    "Dennis Rodman|Detroit|1990s": { ppg:8.8, rpg:9.7, apg:1.8, season:"1989-90" },
    "Bill Laimbeer|Detroit|1990s": { ppg:12.1, rpg:9.3, apg:1.9, season:"1989-90" },
    "Vinnie Johnson|Detroit|1990s": { ppg:11.3, rpg:1.9, apg:2.5, season:"1989-90" },
    "James Edwards|Detroit|1990s": { ppg:14.5, rpg:3.8, apg:1.1, season:"1989-90" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_DET1990S);

  // Detroit Pistons — 2000s (from the 2003-04 54-28 NBA championship team)
  const BBALL_STATS_DET2000S = {
    "Chauncey Billups|Detroit|2000s": { ppg:16.9, rpg:2.9, apg:5.7, season:"2003-04" },
    "Richard Hamilton|Detroit|2000s": { ppg:17.6, rpg:3.3, apg:3.2, season:"2003-04" },
    "Tayshaun Prince|Detroit|2000s": { ppg:10.5, rpg:5.1, apg:2.4, season:"2003-04" },
    "Rasheed Wallace|Detroit|2000s": { ppg:15.4, rpg:7.2, apg:2.1, season:"2003-04" },
    "Ben Wallace|Detroit|2000s": { ppg:9.5, rpg:12.4, apg:1.5, season:"2003-04" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_DET2000S);

  // Detroit Pistons — 2010s (from the 2015-16 44-38 playoff team)
  const BBALL_STATS_DET2010S = {
    "Reggie Jackson|Detroit|2010s": { ppg:18.8, rpg:3.2, apg:6.2, season:"2015-16" },
    "Kentavious Caldwell-Pope|Detroit|2010s": { ppg:14.5, rpg:3.7, apg:1.8, season:"2015-16" },
    "Tobias Harris|Detroit|2010s": { ppg:16.6, rpg:6.2, apg:2.6, season:"2015-16" },
    "Marcus Morris|Detroit|2010s": { ppg:14.1, rpg:5.1, apg:2.5, season:"2015-16" },
    "Andre Drummond|Detroit|2010s": { ppg:16.2, rpg:14.8, apg:0.8, season:"2015-16" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_DET2010S);

  // Detroit Pistons — 2020s (from the 2024-25 44-38 playoff team, Cunningham's first All-Star season)
  const BBALL_STATS_DET2020S = {
    "Cade Cunningham|Detroit|2020s": { ppg:26.1, rpg:6.1, apg:9.1, season:"2024-25" },
    "Jalen Duren|Detroit|2020s": { ppg:12.3, rpg:10.9, apg:1.9, season:"2024-25" },
    "Tobias Harris|Detroit|2020s": { ppg:13.6, rpg:5.6, apg:2.6, season:"2024-25" },
    "Ausar Thompson|Detroit|2020s": { ppg:9.7, rpg:6.9, apg:2.6, season:"2024-25" },
    "Jaden Ivey|Detroit|2020s": { ppg:17.6, rpg:3.9, apg:4.6, season:"2024-25" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_DET2020S);

  // Cleveland Cavaliers — 1980s (from the 1988-89 57-25 team)
  const BBALL_STATS_CLE1980S = {
    "Mark Price|Cleveland|1980s": { ppg:18.9, rpg:3.1, apg:8.4, season:"1988-89" },
    "Ron Harper|Cleveland|1980s": { ppg:18.6, rpg:5.3, apg:4.7, season:"1988-89" },
    "Brad Daugherty|Cleveland|1980s": { ppg:18.9, rpg:9.2, apg:3.7, season:"1988-89" },
    "Larry Nance|Cleveland|1980s": { ppg:17.2, rpg:8.0, apg:2.1, season:"1988-89" },
    "Craig Ehlo|Cleveland|1980s": { ppg:10.6, rpg:3.8, apg:2.9, season:"1988-89" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_CLE1980S);

  // Cleveland Cavaliers — 1990s (from the 1991-92 57-25 Eastern Conference Finals team)
  const BBALL_STATS_CLE1990S = {
    "Brad Daugherty|Cleveland|1990s": { ppg:21.5, rpg:10.4, apg:3.6, season:"1991-92" },
    "Mark Price|Cleveland|1990s": { ppg:17.3, rpg:2.6, apg:7.4, season:"1991-92" },
    "Larry Nance|Cleveland|1990s": { ppg:17.0, rpg:8.3, apg:2.3, season:"1991-92" },
    "John Williams|Cleveland|1990s": { ppg:11.9, rpg:7.6, apg:2.5, season:"1991-92" },
    "Craig Ehlo|Cleveland|1990s": { ppg:12.3, rpg:3.9, apg:3.8, season:"1991-92" },
    "Terrell Brandon|Cleveland|1990s": { ppg:7.4, rpg:2.2, apg:3.9, season:"1991-92" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_CLE1990S);

  // Cleveland Cavaliers — 2000s (from the 2006-07 50-32 team, LeBron's first NBA Finals run)
  const BBALL_STATS_CLE2000S = {
    "LeBron James|Cleveland|2000s": { ppg:27.3, rpg:6.7, apg:6.0, season:"2006-07" },
    "Zydrunas Ilgauskas|Cleveland|2000s": { ppg:13.3, rpg:7.9, apg:1.3, season:"2006-07" },
    "Drew Gooden|Cleveland|2000s": { ppg:12.3, rpg:8.7, apg:1.1, season:"2006-07" },
    "Larry Hughes|Cleveland|2000s": { ppg:14.5, rpg:3.3, apg:3.6, season:"2006-07" },
    "Sasha Pavlovic|Cleveland|2000s": { ppg:11.5, rpg:3.9, apg:1.6, season:"2006-07" },
    "Eric Snow|Cleveland|2000s": { ppg:5.2, rpg:2.4, apg:4.7, season:"2006-07" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_CLE2000S);

  // Cleveland Cavaliers — 2010s (from the 2015-16 57-25 NBA championship team)
  const BBALL_STATS_CLE2010S = {
    "LeBron James|Cleveland|2010s": { ppg:25.3, rpg:7.4, apg:6.8, season:"2015-16" },
    "Kyrie Irving|Cleveland|2010s": { ppg:19.6, rpg:3.2, apg:4.7, season:"2015-16" },
    "Kevin Love|Cleveland|2010s": { ppg:16.0, rpg:9.9, apg:2.0, season:"2015-16" },
    "Tristan Thompson|Cleveland|2010s": { ppg:7.8, rpg:9.0, apg:0.8, season:"2015-16" },
    "J.R. Smith|Cleveland|2010s": { ppg:12.4, rpg:3.2, apg:1.9, season:"2015-16" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_CLE2010S);

  // Cleveland Cavaliers — 2020s (from the 2023-24 48-34 team)
  const BBALL_STATS_CLE2020S = {
    "Donovan Mitchell|Cleveland|2020s": { ppg:26.6, rpg:5.1, apg:6.1, season:"2023-24" },
    "Darius Garland|Cleveland|2020s": { ppg:18.0, rpg:2.7, apg:6.5, season:"2023-24" },
    "Jarrett Allen|Cleveland|2020s": { ppg:16.5, rpg:10.5, apg:1.6, season:"2023-24" },
    "Evan Mobley|Cleveland|2020s": { ppg:15.7, rpg:9.4, apg:3.2, season:"2023-24" },
    "Caris LeVert|Cleveland|2020s": { ppg:14.0, rpg:4.1, apg:5.1, season:"2023-24" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_CLE2020S);

  // Chicago Bulls — 1980s (from the 1987-88 50-32 team, Jordan's MVP/DPOY season)
  const BBALL_STATS_CHI1980S = {
    "Michael Jordan|Chicago|1980s": { ppg:35.0, rpg:5.5, apg:5.9, season:"1987-88" },
    "Charles Oakley|Chicago|1980s": { ppg:12.4, rpg:13.0, apg:3.0, season:"1987-88" },
    "Sam Vincent|Chicago|1980s": { ppg:13.0, rpg:3.6, apg:8.4, season:"1987-88" },
    "Dave Corzine|Chicago|1980s": { ppg:10.1, rpg:6.6, apg:1.9, season:"1987-88" },
    "John Paxson|Chicago|1980s": { ppg:7.9, rpg:1.3, apg:3.7, season:"1987-88" },
    "Horace Grant|Chicago|1980s": { ppg:7.7, rpg:5.5, apg:1.1, season:"1987-88" },
    "Scottie Pippen|Chicago|1980s": { ppg:7.9, rpg:3.8, apg:2.1, season:"1987-88" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_CHI1980S);

  // Chicago Bulls — 2000s (from the 2006-07 49-33 team)
  const BBALL_STATS_CHI2000S = {
    "Luol Deng|Chicago|2000s": { ppg:18.8, rpg:7.1, apg:2.5, season:"2006-07" },
    "Kirk Hinrich|Chicago|2000s": { ppg:16.6, rpg:3.4, apg:6.3, season:"2006-07" },
    "Ben Wallace|Chicago|2000s": { ppg:6.4, rpg:10.7, apg:2.4, season:"2006-07" },
    "Ben Gordon|Chicago|2000s": { ppg:21.4, rpg:3.1, apg:3.6, season:"2006-07" },
    "Andrés Nocioni|Chicago|2000s": { ppg:14.1, rpg:5.7, apg:1.1, season:"2006-07" },
    "Chris Duhon|Chicago|2000s": { ppg:7.2, rpg:2.2, apg:4.0, season:"2006-07" },
    "P.J. Brown|Chicago|2000s": { ppg:6.1, rpg:4.8, apg:0.7, season:"2006-07" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_CHI2000S);

  // Chicago Bulls — 2010s (from the 2010-11 62-20 team, Rose's real youngest-ever MVP season)
  const BBALL_STATS_CHI2010S = {
    "Derrick Rose|Chicago|2010s": { ppg:25.0, rpg:4.1, apg:7.7, season:"2010-11" },
    "Luol Deng|Chicago|2010s": { ppg:17.4, rpg:5.8, apg:2.8, season:"2010-11" },
    "Joakim Noah|Chicago|2010s": { ppg:11.7, rpg:10.4, apg:2.2, season:"2010-11" },
    "Carlos Boozer|Chicago|2010s": { ppg:17.5, rpg:9.6, apg:2.5, season:"2010-11" },
    "Taj Gibson|Chicago|2010s": { ppg:7.1, rpg:5.7, apg:0.7, season:"2010-11" },
    "Kyle Korver|Chicago|2010s": { ppg:8.3, rpg:1.8, apg:1.5, season:"2010-11" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_CHI2010S);

  // Chicago Bulls — 2020s (from the 2021-22 46-36 team, first playoff berth since 2017)
  const BBALL_STATS_CHI2020S = {
    "DeMar DeRozan|Chicago|2020s": { ppg:27.9, rpg:5.2, apg:4.9, season:"2021-22" },
    "Zach LaVine|Chicago|2020s": { ppg:24.4, rpg:4.6, apg:4.5, season:"2021-22" },
    "Nikola Vučević|Chicago|2020s": { ppg:17.6, rpg:11.0, apg:3.2, season:"2021-22" },
    "Lonzo Ball|Chicago|2020s": { ppg:13.0, rpg:5.4, apg:5.1, season:"2021-22" },
    "Coby White|Chicago|2020s": { ppg:12.7, rpg:3.0, apg:2.9, season:"2021-22" },
    "Ayo Dosunmu|Chicago|2020s": { ppg:8.8, rpg:2.8, apg:3.3, season:"2021-22" }
  };
  Object.assign(BBALL_STATS, BBALL_STATS_CHI2020S);
  Object.assign(BBALL_STATS, BBALL_STATS_LAL2020S);
  Object.assign(BBALL_STATS, BBALL_STATS_LAL2010S);
  function bballStatsFor(playerName, team, era){
    return BBALL_STATS[playerName + "|" + team + "|" + era] || null;
  }

  // Positional overlap rules: which native positions are allowed to fill each open slot.
  // Guards (PG/SG) are interchangeable with each other; Forwards (SF/PF) are interchangeable
  // with each other; Centers can also cover PF (but not SF), one-directionally.
  var BBALL_SLOT_ELIGIBLE = {
    PG: ["PG","SG"],
    SG: ["PG","SG"],
    SF: ["SF","PF"],
    PF: ["SF","PF","C"],
    C:  ["C"]
  };

  // Grade tiers are calibrated against the actual pool of draftable players (every player in
  // this dataset is already a real, notable historical statline — there's no true bench
  // filler), so the bar has to sit well above "any random pick" or nearly every team ends up
  // top tier. Benchmarks come from sampling this exact player pool: a team of random picks
  // averages roughly a 117 combined-stat total; a team deliberately drafted from the pool's
  // upper quartile lands near 175; stacking nothing but the pool's top decile (true statistical
  // outliers) lands near 198. Each letter spans a 30-point band split into three 10-point
  // +/- steps, so a "good" draft (B/A range) and a "hardly could be better" draft (S range)
  // are clearly distinguished rather than collapsing into one tier.
  var BBALL_GRADE_TIERS = [
    { min:200, grade:"S+", label:"Peak Squad", blurb:"About as good as this game allows — elite production at every single spot, with no real weak spot to find." },
    { min:190, grade:"S",  label:"Legendary Squad", blurb:"A stacked, all-time fantasy five — MVP-or-superstar-level production at nearly every spot on the floor." },
    { min:180, grade:"S-", label:"Near-Legendary Squad", blurb:"Loaded from top to bottom. One tier from perfect, and still a nightmare matchup for anyone." },
    { min:170, grade:"A+", label:"All-Star Caliber", blurb:"A genuinely loaded roster with multiple star-level picks. This group could hang with anyone." },
    { min:160, grade:"A",  label:"Star-Studded", blurb:"Multiple real stars carrying the lineup, with solid production filling in around them." },
    { min:150, grade:"A-", label:"Very Strong", blurb:"A clearly strong five — more star power than most, even if it's not quite maxed out." },
    { min:140, grade:"B+", label:"Playoff Caliber", blurb:"A well-built, playoff-ready roster. Good production up and down the lineup." },
    { min:130, grade:"B",  label:"Above Average", blurb:"Solid and clearly above a typical lineup — more hits than misses across the five spots." },
    { min:120, grade:"B-", label:"Solid", blurb:"A dependable roster with decent production across the board, without a standout star." },
    { min:110, grade:"C+", label:"Decent", blurb:"A fine group of starters — nothing flashy, but nothing glaring holding it back either." },
    { min:100, grade:"C",  label:"Average", blurb:"A roster about like most others you'd draft — a fine mix of starters, but nothing that stands out." },
    { min:90,  grade:"C-", label:"Below Average", blurb:"A touch light on production. Not a bad group, but clearly missing some star power." },
    { min:80,  grade:"D+", label:"Shaky", blurb:"A roster with real gaps — a weak link or two is dragging down the group's overall production." },
    { min:70,  grade:"D",  label:"Weak", blurb:"Thin production across most of the lineup — a struggling, rebuilding-caliber roster." },
    { min:60,  grade:"D-", label:"Struggling", blurb:"Very little star power here. This roster would have a rough time on the floor." },
    { min:0,   grade:"F",  label:"Rebuilding", blurb:"A true rebuild — this lineup is missing production almost everywhere." }
  ];

  var bball = {
    era: null, team: null,
    roster: [], pool: [],
    slots: { PG:null, SG:null, SF:null, PF:null, C:null },
    candidate: null,
    respinsSinceLastPick: 0
  };

  function openBballDraft(){
    bball.era = null;
    bball.team = null;
    bball.roster = [];
    bball.pool = [];
    bball.slots = { PG:null, SG:null, SF:null, PF:null, C:null };
    bball.candidate = null;
    bball.respinsSinceLastPick = 0;

    document.getElementById("bballEraValue").textContent = "—";
    document.getElementById("bballTeamValue").textContent = "—";
    document.getElementById("bballSetupMsg").textContent = "Spin both to begin.";
    document.getElementById("bballBeginBtn").disabled = true;

    document.getElementById("bballSetup").style.display = "block";
    document.getElementById("bballDraft").style.display = "none";
    document.getElementById("bballComplete").style.display = "none";
  }

  function bballSpinEra(){
    bball.era = BBALL_ERAS[Math.floor(Math.random() * BBALL_ERAS.length)];
    document.getElementById("bballEraValue").textContent = bball.era;
    bballUpdateBeginState();
  }
  function bballSpinTeam(){
    bball.team = BBALL_TEAMS[Math.floor(Math.random() * BBALL_TEAMS.length)];
    document.getElementById("bballTeamValue").textContent = bball.team;
    bballUpdateBeginState();
  }
  function bballUpdateBeginState(){
    var ready = !!(bball.era && bball.team);
    document.getElementById("bballBeginBtn").disabled = !ready;
    document.getElementById("bballSetupMsg").textContent = ready
      ? "Ready — begin the draft, or spin again to reroll either one."
      : "Spin both to begin.";
  }

  function bballBeginDraft(){
    var eraData = BBALL_ROSTERS[bball.era];
    var roster = eraData ? eraData[bball.team] : null;
    if (!roster){
      document.getElementById("bballSetupMsg").textContent =
        "No roster data yet for the " + bball.team + " in the " + bball.era + " — try spinning again. (This starter set covers a few eras/teams so far; more get added over time.)";
      return;
    }
    bball.roster = roster;
    bball.pool = roster.slice();
    bball.slots = { PG:null, SG:null, SF:null, PF:null, C:null };
    bball.candidate = null;
    bball.respinsSinceLastPick = 0;

    updateBballDraftHeader();
    document.getElementById("bballSetup").style.display = "none";
    document.getElementById("bballDraft").style.display = "block";
    document.getElementById("bballComplete").style.display = "none";

    renderBballRoster();
    renderBballEligibleList();
    updateBballRespinButtonState();
    updateBballPickHint();
  }

  function updateBballDraftHeader(){
    var note = BBALL_NOTES[bball.era + "|" + bball.team];
    document.getElementById("bballDraftBanner").innerHTML =
      '<div class="bball-banner-eyebrow">Now Drafting From</div>'
      + '<div class="bball-banner-main"><b>' + bball.team + '</b> — <b>' + bball.era + '</b></div>'
      + (note ? ('<div class="bball-banner-note">' + note + '</div>') : '');
  }

  // Reflects how many "free" re-spins (without locking in a player) are left this round.
  // The normal spin to reveal a new team/era after a pick is allowed, plus one bonus re-spin
  // to correct a bad landing — after that, the button locks until a player is drafted.
  function updateBballRespinButtonState(){
    var btn = document.getElementById("bballSpinPlayerBtn");
    var note = document.getElementById("bballRespinNote");
    if (!btn || !note) return;
    if (bball.respinsSinceLastPick >= 2){
      btn.disabled = true;
      note.textContent = "You've used your extra re-spin — draft a player from this roster to continue.";
    } else if (bball.respinsSinceLastPick === 1){
      btn.disabled = false;
      note.textContent = "1 re-spin remaining before you must draft from this roster.";
    } else {
      btn.disabled = false;
      note.textContent = "";
    }
  }

  function renderBballRoster(){
    var el = document.getElementById("bballRoster");
    el.innerHTML = "";
    BBALL_POSITIONS.forEach(function(pos){
      var filled = bball.slots[pos];
      var isSelectable = !filled && bball.candidate && BBALL_SLOT_ELIGIBLE[pos].indexOf(bball.candidate.pos) !== -1;
      var row = document.createElement("div");
      row.className = "bball-slot" + (filled ? " filled" : "") + (isSelectable ? " selectable" : "");
      row.innerHTML = '<div class="bball-slot-pos">' + pos + '</div><div class="bball-slot-name' + (filled ? "" : " empty") + '">' + (filled ? filled.player.name : "Not yet drafted") + '</div>';
      if (isSelectable){
        row.addEventListener("click", function(){ bballConfirmPlacement(pos); });
      }
      el.appendChild(row);
    });
  }

  function bballStatsLineHtml(playerName, team, era){
    var s = bballStatsFor(playerName, team, era);
    if (!s) return "";
    var franchiseNote = "";
    if (team === "Oklahoma City") {
      var startYear = parseInt(s.season.split("-")[0], 10);
      if (startYear < 2008) franchiseNote = ' <span class="bball-franchise-note">(Seattle SuperSonics)</span>';
    }
    return '<div class="bball-eligible-stats">' + s.ppg.toFixed(1) + ' PPG · ' + s.rpg.toFixed(1) + ' RPG · ' + s.apg.toFixed(1) + ' APG <span class="bball-eligible-season">(' + s.season + ')</span>' + franchiseNote + '</div>';
  }

  // The primary interactive picker: each pool player is listed exactly once, grouped under
  // their own natural position (only players eligible for at least one open slot — via the
  // Guard/Forward/Center overlap rules in BBALL_SLOT_ELIGIBLE — are shown at all). Tapping a
  // player selects them as the current candidate rather than drafting them immediately; the
  // roster grid above then highlights every open slot they're eligible for, and the user must
  // tap one of those slots to confirm the placement (see bballConfirmPlacement).
  function renderBballEligibleList(){
    var el = document.getElementById("bballEligibleList");
    el.innerHTML = "";
    var openSlots = BBALL_POSITIONS.filter(function(pos){ return !bball.slots[pos]; });

    var eligible = bball.pool.filter(function(p){
      return openSlots.some(function(slot){ return BBALL_SLOT_ELIGIBLE[slot].indexOf(p.pos) !== -1; });
    });

    if (eligible.length === 0){
      el.innerHTML = '<div class="bball-candidate-hint">No eligible players in this roster for your remaining spot(s). Tap "Re-Spin for Next Player" to try a different team/era.</div>';
      return;
    }

    BBALL_POSITIONS.forEach(function(pos){
      var players = eligible.filter(function(p){ return p.pos === pos; });
      if (players.length === 0) return;
      var group = document.createElement("div");
      group.className = "bball-eligible-group";
      var label = document.createElement("div");
      label.className = "bball-eligible-pos-label";
      label.textContent = pos;
      group.appendChild(label);
      players.forEach(function(p){
        var btn = document.createElement("button");
        btn.className = "bball-eligible-player" + (bball.candidate === p ? " selected" : "");
        btn.innerHTML = '<div class="bball-eligible-name">' + p.name + '</div>' + bballStatsLineHtml(p.name, bball.team, bball.era);
        btn.addEventListener("click", function(){ bballSelectCandidate(p); });
        group.appendChild(btn);
      });
      el.appendChild(group);
    });
  }

  // Tapping a player in the eligible list toggles them as the pending candidate (tapping the
  // same player again deselects them) — nothing is drafted yet until a slot is confirmed.
  // When newly selected (not deselected), scroll back up so the sticky banner and the now-
  // highlighted open slots in the roster grid are visible without the user hunting for them.
  function bballSelectCandidate(p){
    var isNewlySelected = bball.candidate !== p;
    bball.candidate = isNewlySelected ? p : null;
    renderBballEligibleList();
    renderBballRoster();
    updateBballPickHint();
    if (isNewlySelected){
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function updateBballPickHint(){
    var hint = document.getElementById("bballPickHint");
    if (!hint) return;
    if (bball.candidate){
      var openEligible = BBALL_POSITIONS.filter(function(slot){
        return !bball.slots[slot] && BBALL_SLOT_ELIGIBLE[slot].indexOf(bball.candidate.pos) !== -1;
      });
      hint.textContent = bball.candidate.name + " selected — tap an open " + openEligible.join("/") + " slot above to confirm.";
      hint.style.display = "block";
    } else {
      hint.textContent = "";
      hint.style.display = "none";
    }
  }

  // Finalizes the currently-selected candidate into the tapped slot. Only called from a slot
  // that renderBballRoster already marked "selectable" for this candidate, but the eligibility
  // check is repeated here as a guard.
  function bballConfirmPlacement(slot){
    if (!bball.candidate) return;
    if (BBALL_SLOT_ELIGIBLE[slot].indexOf(bball.candidate.pos) === -1) return;

    var pick = bball.candidate;
    // Store which team/era this specific pick came from — needed since later re-spins
    // change bball.team/bball.era, and we still want correct stats lookups afterward.
    bball.slots[slot] = { player: pick, team: bball.team, era: bball.era };
    bball.pool = bball.pool.filter(function(p){ return p !== pick; });
    bball.candidate = null;
    bball.respinsSinceLastPick = 0;

    renderBballRoster();
    updateBballRespinButtonState();
    updateBballPickHint();

    var allFilled = BBALL_POSITIONS.every(function(pos){ return bball.slots[pos]; });
    if (allFilled){
      bballFinishDraft();
    } else {
      document.getElementById("bballEligibleList").innerHTML = '<div class="bball-candidate-hint">' + pick.name + ' locked in at ' + slot + '. Tap "Re-Spin for Next Player" to find your next pick.</div>';
    }
  }

  // Only the very first player is drawn from the era/team chosen in setup. Every pick after
  // that comes from a freshly re-randomized era+team — this is what actually builds the
  // "any era, any team" fantasy roster. Retries silently (capped) if a spin lands on a
  // combo with no data yet, or one with nothing eligible for the remaining open spot(s),
  // accounting for the Guard/Forward/Center overlap rules. Beyond the spin needed to reveal
  // a new team/era after a pick, only one extra "unhappy with this landing" re-spin is
  // allowed before the button locks and a player must be drafted from the current roster.
  function bballRespinForNextPlayer(){
    var openPositions = BBALL_POSITIONS.filter(function(pos){ return !bball.slots[pos]; });
    if (openPositions.length === 0) return;

    if (bball.respinsSinceLastPick >= 2){
      updateBballRespinButtonState();
      return;
    }

    var eligibleNativePositions = {};
    openPositions.forEach(function(slot){
      BBALL_SLOT_ELIGIBLE[slot].forEach(function(nativePos){ eligibleNativePositions[nativePos] = true; });
    });

    var found = false, attempts = 0, newEra, newTeam, newRoster;
    while (!found && attempts < 300){
      attempts++;
      newEra = BBALL_ERAS[Math.floor(Math.random() * BBALL_ERAS.length)];
      newTeam = BBALL_TEAMS[Math.floor(Math.random() * BBALL_TEAMS.length)];
      var eraData = BBALL_ROSTERS[newEra];
      newRoster = eraData ? eraData[newTeam] : null;
      if (!newRoster) continue;
      if (newRoster.some(function(p){ return eligibleNativePositions[p.pos]; })) found = true;
    }

    if (!found){
      document.getElementById("bballEligibleList").innerHTML = '<div class="bball-candidate-hint">Couldn\'t find a stocked roster for your remaining spot(s) — try spinning again.</div>';
      return;
    }

    bball.era = newEra;
    bball.team = newTeam;
    bball.roster = newRoster;
    bball.pool = newRoster.slice();
    bball.candidate = null;
    bball.respinsSinceLastPick++;

    updateBballDraftHeader();
    updateBballRespinButtonState();
    updateBballPickHint();
    renderBballRoster();
    renderBballEligibleList();
  }

  // Rough team evaluation: averages each drafted player's combined PPG+RPG+APG (from the
  // stat line tied to the specific team/era they were drafted from), scales that average up
  // to a full 5-player estimate so a missing stat line or two doesn't tank the grade, and
  // maps the result onto the tier ladder above.
  function bballGradeTeam(){
    var total = 0, counted = 0;
    BBALL_POSITIONS.forEach(function(pos){
      var slot = bball.slots[pos];
      if (!slot) return;
      var s = bballStatsFor(slot.player.name, slot.team, slot.era);
      if (s){ total += (s.ppg + s.rpg + s.apg); counted++; }
    });
    if (counted === 0){
      return { grade:"—", label:"Unrated", blurb:"We don't have stat lines for these picks yet, so this roster can't be graded." };
    }
    var estTotal = (total / counted) * 5;
    var tier = BBALL_GRADE_TIERS[BBALL_GRADE_TIERS.length - 1];
    for (var i = 0; i < BBALL_GRADE_TIERS.length; i++){
      if (estTotal >= BBALL_GRADE_TIERS[i].min){ tier = BBALL_GRADE_TIERS[i]; break; }
    }
    var coverageNote = counted < 5 ? (" (based on " + counted + " of 5 picks with stats on file)") : "";
    return { grade: tier.grade, label: tier.label, blurb: tier.blurb + coverageNote };
  }

  function bballFinishDraft(){
    document.getElementById("bballDraft").style.display = "none";
    document.getElementById("bballComplete").style.display = "block";
    var el = document.getElementById("bballFinalList");
    el.innerHTML = "";
    BBALL_POSITIONS.forEach(function(pos){
      var slot = bball.slots[pos];
      var row = document.createElement("div");
      row.className = "bball-slot filled";
      var statsLine = bballStatsFor(slot.player.name, slot.team, slot.era);
      var sub = '<div class="bball-slot-sub">' + slot.team + ' — ' + slot.era + (statsLine ? (' · ' + statsLine.ppg.toFixed(1) + '/' + statsLine.rpg.toFixed(1) + '/' + statsLine.apg.toFixed(1)) : '') + '</div>';
      row.innerHTML = '<div class="bball-slot-pos">' + pos + '</div><div><div class="bball-slot-name">' + slot.player.name + '</div>' + sub + '</div>';
      el.appendChild(row);
    });

    var grade = bballGradeTeam();
    document.getElementById("bballGradeCard").innerHTML =
      '<div class="bball-grade-letter">' + grade.grade + '</div>'
      + '<div class="bball-grade-label">' + grade.label + '</div>'
      + '<div class="bball-grade-detail">' + grade.blurb + '</div>';
  }

  document.getElementById("bballBackBtn").addEventListener("click", function(){ showPage("favoritesPage"); });
  document.getElementById("bballSpinEraBtn").addEventListener("click", bballSpinEra);
  document.getElementById("bballSpinTeamBtn").addEventListener("click", bballSpinTeam);
  document.getElementById("bballBeginBtn").addEventListener("click", bballBeginDraft);
  document.getElementById("bballSpinPlayerBtn").addEventListener("click", bballRespinForNextPlayer);
  document.getElementById("bballPlayAgainBtn").addEventListener("click", openBballDraft);
  // "Draft Menu" stays inside the Basketball Draft mini-game — it returns to this game's own
  // Begin Draft setup screen, rather than exiting out to the Fox Games main menu.
  document.getElementById("bballMainMenuBtn").addEventListener("click", openBballDraft);

  loadStore();
  ensureFavorites();
  applyTheme(store.settings.theme || "dark");
  renderFavorites();
})();
