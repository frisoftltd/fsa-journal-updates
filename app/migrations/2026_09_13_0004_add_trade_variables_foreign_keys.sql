-- Enforces referential integrity on trade_variables so the orphaning bug
-- fixed by the previous migration cannot happen silently again.
--
-- variable_id -> strategy_variables(id) ON DELETE RESTRICT: deleting a
-- variable that still has recorded answers becomes impossible at the
-- database level. This forces the application layer to deactivate instead
-- of delete (see StrategyBuilderController::saveVariables). Do not change
-- this to CASCADE — that would turn today's silent orphaning into silent
-- data loss, which is worse.
--
-- trade_id -> trades(id) ON DELETE CASCADE: deleting a trade correctly
-- takes its recorded answers with it.
--
-- If this ALTER fails, the remap migration immediately before this one did
-- not leave trade_variables fully clean — report it, do not retry with
-- foreign_key_checks disabled.

ALTER TABLE trade_variables
    ADD CONSTRAINT fk_trade_variables_variable_id
        FOREIGN KEY (variable_id) REFERENCES strategy_variables(id) ON DELETE RESTRICT,
    ADD CONSTRAINT fk_trade_variables_trade_id
        FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE;
