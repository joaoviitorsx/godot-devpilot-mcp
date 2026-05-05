# ADD_FEATURE

> Feature: [NAME + behavior]

1. `devpilot_execute_prompt_workflow` mode=`ADD_FEATURE` dry_run=`true`.
2. Review the plan + diagnostics.
3. Call `devpilot_build_feature` with the feature_name and kind from the plan.
4. Run validation pipeline.
