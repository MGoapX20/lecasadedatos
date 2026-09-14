/** Show the map during play, and clear it for briefings, results and menus. */
export const showHudMap=(stage:string,menuOpen:boolean)=>!menuOpen&&['round1','round2a','round2b'].includes(stage);
