
<?php
/**
 * FundedControl — API Router v3.0.0
 * Maps every action to its controller. Adding a feature = 1 new controller + 1 route line.
 */

$action = $_GET['action'] ?? '';

$routes = [
    // Profile
    'get_user'              => ['ProfileController', 'getUser'],
    'update_profile'        => ['ProfileController', 'updateProfile'],
    'update_settings'       => ['ProfileController', 'updateSettings'],
    // Challenges
    'get_challenges'        => ['ChallengeController', 'getAll'],
    'get_active_challenge'  => ['ChallengeController', 'getActive'],
    'add_challenge'         => ['ChallengeController', 'add'],
    'update_challenge'      => ['ChallengeController', 'update'],
    'delete_challenge'      => ['ChallengeController', 'delete'],
    'switch_challenge'      => ['ChallengeController', 'switchTo'],
    // Trades
    'get_trades'            => ['TradeController', 'getAll'],
    'add_trade'             => ['TradeController', 'add'],
    'update_trade'          => ['TradeController', 'update'],
    'delete_trade'          => ['TradeController', 'delete'],
    // Stats
    'get_stats'             => ['StatsController', 'getStats'],
    // Alerts
    'get_alerts'            => ['AlertController', 'getAlerts'],
    // Calculator
    'calculate_risk'        => ['CalculatorController', 'calculate'],
    'size_preview'          => ['CalculatorController', 'sizePreview'],
    'auto_risk_preview'     => ['CalculatorController', 'autoRiskPreview'],
    'get_risk_status'       => ['CalculatorController', 'getRiskStatus'],
    // Pairs
    'get_pairs'             => ['PairController', 'getAll'],
    'add_pair'              => ['PairController', 'add'],
    'delete_pair'           => ['PairController', 'delete'],
    // Import
    'import_trades'         => ['ImportController', 'import'],
    // Bitfunded paste importer (v3.14.0)
    'preview_bitfunded_import' => ['BitfundedImportController', 'preview'],
    'confirm_bitfunded_import' => ['BitfundedImportController', 'confirm'],
    // Strategy
    'get_strategy_trades'   => ['StrategyController', 'getAll'],
    'get_strategy_stats'    => ['StrategyController', 'getStats'],
    'add_strategy_trade'    => ['StrategyController', 'add'],
    'delete_strategy_trade' => ['StrategyController', 'delete'],
    // Reviews (manual, legacy)
    'get_reviews'           => ['ReviewController', 'getAll'],
    'save_review'           => ['ReviewController', 'save'],
    // Review Engine (behavioral, automatic)
    'get_review'            => ['ReviewEngineController', 'getReview'],
    'get_review_periods'    => ['ReviewEngineController', 'listPeriods'],
    // Strategy Builder (dynamic strategies)
    'get_strategies'        => ['StrategyBuilderController', 'getAll'],
    'add_strategy'          => ['StrategyBuilderController', 'add'],
    'update_strategy'       => ['StrategyBuilderController', 'update'],
    'delete_strategy'       => ['StrategyBuilderController', 'delete'],
    'save_strategy_vars'    => ['StrategyBuilderController', 'saveVariables'],
    'get_leaderboard'       => ['StrategyBuilderController', 'getLeaderboard'],
    // Report Card (v3.18.0)
    'get_report_card'                       => ['ReportCardController', 'getCard'],
    'save_report_card'                      => ['ReportCardController', 'saveCard'],
    'get_report_card_history'               => ['ReportCardController', 'getHistory'],
    'add_report_card_block'                 => ['ReportCardController', 'addBlock'],
    'update_report_card_block'              => ['ReportCardController', 'updateBlock'],
    'delete_report_card_block'              => ['ReportCardController', 'deleteBlock'],
    'reorder_report_card_blocks'            => ['ReportCardController', 'reorderBlocks'],
    'get_report_card_templates'             => ['ReportCardController', 'getTemplates'],
    'add_report_card_template'              => ['ReportCardController', 'addTemplate'],
    'update_report_card_template'           => ['ReportCardController', 'updateTemplate'],
    'delete_report_card_template'           => ['ReportCardController', 'deleteTemplate'],
    'apply_report_card_template'            => ['ReportCardController', 'applyTemplate'],
    'save_report_card_blocks_as_template'   => ['ReportCardController', 'saveBlocksAsTemplate'],
    'get_report_card_mantras'               => ['ReportCardController', 'getMantras'],
    'add_report_card_mantra'                => ['ReportCardController', 'addMantra'],
    'update_report_card_mantra'             => ['ReportCardController', 'updateMantra'],
    'delete_report_card_mantra'             => ['ReportCardController', 'deleteMantra'],
    'toggle_report_card_mantra_check'       => ['ReportCardController', 'toggleMantraCheck'],
    'add_report_card_ticker'                => ['ReportCardController', 'addTicker'],
    'update_report_card_ticker'             => ['ReportCardController', 'updateTicker'],
    'delete_report_card_ticker'             => ['ReportCardController', 'deleteTicker'],
    'upload_report_card_ticker_image'       => ['ReportCardController', 'uploadTickerImage'],
    'delete_report_card_ticker_image'       => ['ReportCardController', 'deleteTickerImage'],
    // Report Card AI Review
    'run_ai_review'          => ['ReportCardAiController', 'runReview'],
    'run_weekly_ai_review'   => ['ReportCardAiController', 'runWeeklyReview'],
    'get_ai_reviews'         => ['ReportCardAiController', 'getReviews'],
    'get_ai_review'          => ['ReportCardAiController', 'getReview'],
    'acknowledge_ai_finding' => ['ReportCardAiController', 'acknowledgeFinding'],
];

if (!isset($routes[$action])) {
    jsonError('Unknown action');
}

[$controllerName, $method] = $routes[$action];
require_once __DIR__ . "/controllers/{$controllerName}.php";
$controller = new $controllerName();
$controller->$method();
