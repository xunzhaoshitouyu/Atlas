define([
    'knockout',
    'pages/characterizations/services/FeatureAnalysisService',
    'pages/characterizations/services/PermissionService',
    'components/cohortbuilder/CriteriaGroup',
    'components/cohortbuilder/AdditionalCriteria',
    'components/cohortbuilder/WindowedCriteria',
    'components/cohortbuilder/CriteriaTypes/DemographicCriteria',
    'components/cohortbuilder/components/const',
    'components/cohortbuilder/components/utils',
    'text!./feature-analysis-view-edit.html',
    'appConfig',
    'atlas-state',
    'services/AuthAPI',
    'services/Vocabulary',
    'conceptsetbuilder/InputTypes/ConceptSet',
    'pages/Page',
    'pages/characterizations/const',
    'utils/AutoBind',
    'utils/CommonUtils',
    'assets/ohdsi.util',
    '../../utils',
    'less!./feature-analysis-view-edit.less',
    'components/cohortbuilder/components',
    'circe',
    'components/multi-select',
		'components/DropDownMenu',
], function (
    ko,
    FeatureAnalysisService,
    PermissionService,
    CriteriaGroup,
    AdditionalCriteria,
    WindowedCriteria,
    DemographicGriteria,
    cohortbuilderConsts,
    cohortbuilderUtils,
    view,
    config,
    sharedState,
    authApi,
    VocabularyAPI,
    ConceptSet,
    Page,
	  constants,
    AutoBind,
    commonUtils,
    ohdsiUtil,
    utils,
) {

    const featureTypes = {
        PRESET: 'PRESET',
        CRITERIA_SET: 'CRITERIA_SET',
        CUSTOM_FE: 'CUSTOM_FE',
    };

    const statTypeOptions = [
      { label: 'Prevalence', value: 'PREVALENCE' },
      { label: 'Distribution', value: 'DISTRIBUTION' },
    ];

    class FeatureAnalysisViewEdit extends AutoBind(Page) {
        constructor(params) {
            super(params);

            this.featureId = sharedState.FeatureAnalysis.selectedId;
            this.data = sharedState.FeatureAnalysis.current;
            this.domains = ko.observable([]);
            this.previousDesign = {};

            this.dataDirtyFlag = sharedState.FeatureAnalysis.dirtyFlag;
            this.loading = ko.observable(false);

            this.canEdit = this.isUpdatePermittedResolver();
            this.canSave = ko.computed(() => {
                return this.dataDirtyFlag().isDirty() && this.areRequiredFieldsFilled() && (this.featureId() === 0 ? this.isCreatePermitted() : this.canEdit());
            });
            this.canDelete = this.isDeletePermittedResolver();

            this.saveTooltipText = this.getSaveTooltipTextComputed();

            // Concept set import for criteria
            this.criteriaContext = ko.observable();
            this.showConceptSetBrowser = ko.observable();

            this.featureTypes = featureTypes;
            this.statTypeOptions = ko.observableArray(statTypeOptions);
            this.demoCustomSqlAnalysisDesign = constants.demoCustomSqlAnalysisDesign;

            this.windowedActions = cohortbuilderConsts.AddWindowedCriteriaActions.map(a => ({...a, action: this.buildAddCriteriaAction(a.type) }));
            this.formatCriteriaOption = cohortbuilderUtils.formatDropDownOption;
        }

        onPageCreated() {
            this.loadDomains();
            super.onPageCreated();
        }

        onRouterParamsChanged({ id }) {
            if (id !== undefined) {
                this.featureId(parseInt(id));
                if (this.featureId() === 0) {
                    this.setupAnalysisData({});
                } else {
                    this.loadDesign(this.featureId());
                }
            }
        }

        buildAddCriteriaAction(type) {
					return () => this.addWindowedCriteria(type);
				}

        isCreatePermitted() {
            return PermissionService.isPermittedCreateFa();
        }

        isUpdatePermittedResolver() {
            return ko.computed(() => this.featureId() === 0 || PermissionService.isPermittedUpdateFa(this.featureId()));
        }

        isDeletePermittedResolver(id) {
            return ko.computed(() => PermissionService.isPermittedDeleteFa(this.featureId()));
        }

        areRequiredFieldsFilled() {
            const isDesignFilled = this.data() && ((typeof this.data().design() === 'string' || Array.isArray(this.data().design())) && this.data().design().length > 0);
            return this.data() && (typeof this.data().name() === 'string' && this.data().name().length > 0 && typeof this.data().type() === 'string' && this.data().type().length > 0 && isDesignFilled);
        }

        getSaveTooltipTextComputed() {
            return ko.computed(() => {
               if (!(this.featureId() === 0 ? this.isCreatePermitted() : this.canEdit())) {
                   return 'Not enough permissions';
               } else if (this.areRequiredFieldsFilled()) {
                   return 'No changes to persist';
               } else {
                   return 'Name and design should not be empty';
               }
            });
        }

        async loadDomains() {
            const domains = await FeatureAnalysisService.loadFeatureAnalysisDomains();
            this.domains(domains.map(d => ({ label: d.name, value: d.id })));
        }

        async loadDesign(id) {
            if (this.data() && (this.data().id || 0 === id)) return;
            if (this.dataDirtyFlag().isDirty() && !confirm("Your changes are not saved. Would you like to continue?")) {
                return;
            }
            this.loading(true);

            const featureAnalysis = await FeatureAnalysisService.loadFeatureAnalysis(id);
            this.setupAnalysisData(featureAnalysis);

            this.loading(false);
        }

        setupAnalysisData({ id = 0, name = '', descr = '', domain = '', type = '', design= '', conceptSets = [], statType = 'PREVALENCE' }) {
            let parsedDesign;
            const data = {
              id: id,
              name: ko.observable(),
              domain: ko.observable(),
              descr: ko.observable(),
              type: ko.observable(),
              design: ko.observable(),
							statType: ko.observable(),
              conceptSets: ko.observableArray(),
            };
            data.conceptSets(conceptSets.map(set => ({ ...set, name: ko.observable(set.name), })));

            if (type === this.featureTypes.CRITERIA_SET) {
                parsedDesign = design.map(c => {
										const commonDesign = {
											id: c.id,
											name: ko.observable(c.name),
											criteriaType: c.criteriaType,
										};
                		if (c.criteriaType === 'CriteriaGroup') {
											return {
												...commonDesign,
												expression: ko.observable(new CriteriaGroup(c.expression, data.conceptSets)),
											};
										} else if (c.criteriaType === 'DemographicCriteria') {
											return {
												...commonDesign,
												expression: ko.observable(new DemographicGriteria(c.expression, data.conceptSets)),
											};
										} else if (c.criteriaType === 'WindowedCriteria' && c.expression.Criteria) {
                			return {
												...commonDesign,
												expression: ko.observable(new WindowedCriteria(c.expression, data.conceptSets)),
											};
										}
                }).filter(c => c);
            } else {
                parsedDesign = design;
            }

            data.name(name);
            data.descr(descr);
            data.domain(domain);
            data.type(type);
            data.design(parsedDesign);
            data.statType(statType);
						data.statType.subscribe(() => this.data.design([]));
            this.data(data);
            this.dataDirtyFlag(new ohdsiUtil.dirtyFlag(this.data()));
            this.previousDesign = { [type]: parsedDesign };
        }

        setType(type) {
            let prevType = this.data().type();
            let prevDesign = this.data().design();

            if (type === this.featureTypes.CRITERIA_SET) {
                let newDesign = this.previousDesign[type] || [this.getEmptyCriteriaFeatureDesign()];
                this.data().design(newDesign);
            } else {
                let newDesign = this.previousDesign[type] || null;
                this.data().design(newDesign);
            }
            this.data().type(type);

            this.previousDesign[prevType] = prevDesign;
        }

        getEmptyCriteriaFeatureDesign() {
            return {
                name: ko.observable(''),
								criteriaType: 'CriteriaGroup',
                conceptSets: this.data().conceptSets,
                expression: ko.observable(new CriteriaGroup(null, this.data().conceptSets)),
            };
        }

        getEmptyWindowedCriteria(type) {
        	const data = { Criteria: {} };
        	data.Criteria[type] = { IgnoreObservationPeriod: true, };
        	return {
        		name: ko.observable(''),
						criteriaType: 'WindowedCriteria',
						expression: ko.observable(new WindowedCriteria(data, this.data.conceptSets)),
					};
				}

				getEmptyDemographicCriteria() {
            return {
              name: ko.observable(''),
              criteriaType: 'DemographicCriteria',
              expression: ko.observable(new DemographicGriteria()),
            };
        }

        addCriteria() {
            this.data().design([...this.data().design(), this.getEmptyCriteriaFeatureDesign()]);
        }

        addWindowedCriteria(type) {
        	const criteria = type === cohortbuilderConsts.CriteriaTypes.DEMOGRAPHIC ? this.getEmptyDemographicCriteria() : this.getEmptyWindowedCriteria(type);
        	this.data.design([...this.data.design(), criteria]);
				}

        removeCriteria(index) {
            const criteriaList = this.data().design();
            criteriaList.splice(index, 1);
            this.data().design(criteriaList);
        }

        handleConceptSetImport(criteriaIdx, item) {
            this.criteriaContext({...item, criteriaIdx});
            this.showConceptSetBrowser(true);
        }

        onRespositoryConceptSetSelected(conceptSet, source) {
            utils.conceptSetSelectionHandler(this.data().conceptSets, this.criteriaContext(), conceptSet, source)
              .done(() => this.showConceptSetBrowser(false));
        }

        handleEditConceptSet() {

        }

        async save() {
            console.log('Saving: ', JSON.parse(ko.toJSON(this.data())));

            if (this.featureId() < 1) {
                const res = await FeatureAnalysisService.createFeatureAnalysis(this.data());
                this.dataDirtyFlag().reset();
                commonUtils.routeTo('/cc/feature-analyses/' + res.id);
            } else {
                const res = await FeatureAnalysisService.updateFeatureAnalysis(this.featureId(), this.data());
                this.setupAnalysisData(res);
                this.loading(false);
            }
        }

        deleteFeature() {
            commonUtils.confirmAndDelete({
                loading: this.loading,
                remove: () => FeatureAnalysisService.deleteFeatureAnalysis(this.featureId()),
                redirect: this.closeAnalysis
            });
        }

        closeAnalysis() {
            if (this.dataDirtyFlag().isDirty() && !confirm("Your changes are not saved. Would you like to continue?")) {
              return;
            }
            this.data(null);
            this.featureId(null);
            this.dataDirtyFlag().reset();
            commonUtils.routeTo('/cc/feature-analyses');
        }
    }

    return commonUtils.build('feature-analysis-view-edit', FeatureAnalysisViewEdit, view);
});