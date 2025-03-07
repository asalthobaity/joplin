const gulp = require('gulp');
const utils = require('@joplin/tools/gulp/utils');
const compileSass = require('@joplin/tools/compileSass');

const tasks = {
	compileScripts: {
		fn: require('./tools/compileScripts'),
	},
	compilePackageInfo: {
		fn: require('./tools/compile-package-info.js'),
	},
	copyPluginAssets: {
		fn: require('./tools/copyPluginAssets.js'),
	},
	copyTinyMceLangs: {
		fn: require('./tools/copyTinyMceLangs.js'),
	},
	electronRebuild: {
		fn: require('./tools/electronRebuild.js'),
	},
	tsc: require('@joplin/tools/gulp/tasks/tsc'),
	updateIgnoredTypeScriptBuild: require('@joplin/tools/gulp/tasks/updateIgnoredTypeScriptBuild'),
	buildCommandIndex: require('@joplin/tools/gulp/tasks/buildCommandIndex'),
	compileSass: {
		fn: async () => {
			const guiDir = `${__dirname}/gui`;
			await compileSass([
				`${guiDir}/EncryptionConfigScreen/style.scss`,
			], `${__dirname}/style.min.css`);
		},
	},
};

utils.registerGulpTasks(gulp, tasks);

const buildParallel = [
	'compileScripts',
	'compilePackageInfo',
	'copyPluginAssets',
	'copyTinyMceLangs',
	'updateIgnoredTypeScriptBuild',
	'buildCommandIndex',
	'compileSass',
];

gulp.task('build', gulp.parallel(...buildParallel));
