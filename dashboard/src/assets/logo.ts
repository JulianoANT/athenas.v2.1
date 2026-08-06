// =============================================================================
//  Ponto unico de importacao da identidade visual da Athenas.
//
//  Todo componente que exibe a marca importa DAQUI, nunca do arquivo do asset
//  direto. Trocar o logotipo passa a ser uma alteracao de uma linha, e o
//  compilador aponta qualquer ponto que tenha ficado para tras.
// =============================================================================

import athenasLogo from "./athenas-logo.svg";

/** Logotipo oficial do sistema Athenas. */
export const ATHENAS_LOGO = athenasLogo;

/** Texto alternativo padrao (acessibilidade). */
export const ATHENAS_LOGO_ALT = "Athenas — Central de Telemetria";

export default ATHENAS_LOGO;
