
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
    // Pairs
    'get_pairs'             => ['PairController', 'getAll'],
    'add_pair'              => ['PairController', 'add'],
    'delete_pair'           => ['PairController', 'delete'],
    // Import
    'import_trades'         => ['ImportController', 'import'],
    // Strategy
    'get_strategy_trades'   => ['StrategyController', 'getAll'],
    'get_strategy_stats'    => ['StrategyController', 'getStats'],
    'add_strategy_trade'    => ['StrategyController', 'add'],
    'delete_strategy_trade' => ['StrategyController', 'delete'],
    // Reviews
    'get_reviews'           => ['ReviewController', 'getAll'],
    'save_review'           => ['ReviewController', 'save'],
    // Strategy Builder (dynamic strategies)
    'get_strategies'        => ['StrategyBuilderController', 'getAll'],
    'add_strategy'          => ['StrategyBuilderController', 'add'],
    'update_strategy'       => ['StrategyBuilderController', 'update'],
    'delete_strategy'       => ['StrategyBuilderController', 'delete'],
    'save_strategy_vars'    => ['StrategyBuilderController', 'saveVariables'],
    'get_leaderboard'       => ['StrategyBuilderController', 'getLeaderboard'],
];

if (!isset($routes[$action])) {
    jsonError('Unknown action');
}

[$controllerName, $method] = $routes[$action];
require_once __DIR__ . "/controllers/{$controllerName}.php";
$controller = new $controllerName();
$controller->$method();
