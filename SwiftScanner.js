// Required modules
const { execSync } = require('child_process');
const Parser = require('tree-sitter');
const Swift = require('tree-sitter-swift');
const fs = require("fs").promises;
const path = require("path");

/**
 * SwiftScanner class for scanning Swift files and extracting components.
 */
class SwiftScanner {
    /**
     * Constructor for SwiftScanner.
     * @param {Array} designSystemModules - Array of design system modules.
     */
    constructor() {
        // Initialize properties
        this.modulesList = {};
        this.thirdPartyDependencies = [];
        this.codebaseComponents = [];
        this.codebaseComponentsPath = "codebase_components.json";
        this.projectComponents = [];
        this.componentsDataset = {};
        this.scannedLibraries = new Set();
        this.datasetFilePath = "components_dataset.json";
        this.parser = new Parser();
        this.parser.setLanguage(Swift);
        this.projectModulesList = [];
        this.externalModules = {};
    }

    /**
     * Initialize method to initialize the scanner.
     */
    async initialize(designSystemModules=[]) {
        try {
            this.designSystemModules = designSystemModules;
            await this.initiateBuild();
            // Initialize project modules list
            await this.getDebugYaml(); // Wait for projectModulesList to be populated
        } catch (error) {
            if (error.code === 'ENOENT') {
                // Dataset file does not exist, recreate it
                await this.saveDataset();
            } else {
                // Error occurred while reading dataset, handle bad format
                console.log(`Error loading dataset: ${error.message}`);
                await this.saveDataset(); // Recreate dataset file
            }
        }
    }

    async loadDataset() {
        try {
          // Read the content of the JSON file
          const datasetContent = await fs.readFile(this.datasetFilePath);
      
          // Parse the JSON content into an object
          const dataset = JSON.parse(datasetContent);
      
          this.componentsDataset = dataset;
        } catch (error) {
          console.error('Error loading dataset:', error);
        }
      }

    getDebugYaml() {
        const fss = require('fs');
        const yaml = require('js-yaml');
    
        return new Promise((resolve, reject) => {
            fss.readFile('.build/debug.yaml', 'utf8', (err, fileData) => {
                if (err) {
                    console.error('Error reading file:', err);
                    reject(err);
                    return;
                }
                /*
>>> o[56600:56900]
'-gnu/debug/Spectre.build/Reporters.swift.o","/root/figma-export/.build/x86_64-unknown-linux-gnu/debug/Spectre.build/XCTest.swift.o","/root/figma-export/.build/x86_64-unknown-linux-gnu/debug/Spectre.swiftmodule"]\n    outputs: ["<Spectre-debug.module>"]\n\n  "<Stencil-debug.module>":\n    tool: phony\n   '
>>>

                */
    
                try {
                    // Parse the YAML data
                    const data = yaml.load(fileData);
                    // Extract the modules from the commands data
                    const inputs = data.commands.PackageStructure.inputs;
                    const moduleKeys = Object.keys(data.commands).filter(
                        key => key.startsWith('C.')
                    );
    
                    moduleKeys
                        .filter(mod => (
                            data.commands[mod].inputs[0].includes('.build/checkouts') ||
                            !data.commands[mod].inputs[0].includes('.build')
                        ))
                        .map(mod => {
                            const originalPath = data.commands[mod].inputs[0];
                            let path = '';
                            if (originalPath.includes('.build/checkouts')) {
                                const parentPath = originalPath.split('.build/checkouts')[0];
                                const splittedLibrary = originalPath.split('.build/checkouts')[1].split('/');
                                splittedLibrary.pop();
                                const library = splittedLibrary.join('/');
                                 path = `${parentPath}.build/checkouts${library}`;
                            } else {
                                const splittedPath = originalPath.split('/');
                                splittedPath.pop();
                                path = splittedPath.join('/');
                            }
                            this.projectModulesList.push({
                                name: mod.substring(2, mod.lastIndexOf("-")),
                                path: path,
                                originalPath: originalPath,
                                isThirdParty: originalPath.includes('.build/checkouts')
                            });
                        }); 
                    resolve();
                } catch (error) {
                    console.error('Error parsing YAML:', error);
                    reject(error);
                }
            });
        });
    }


    async generateDataset() {
        console.log('Generating a dataset of importable components...');
        try {
            // Create an array to store all asynchronous tasks
            const tasks = this.projectModulesList.map(async module => {
                try {
                    // Read the file content asynchronously
                    const filePath = module.originalPath; // Adjust this according to your project structure
                    const fileContent = await fs.readFile(filePath, 'utf-8');
    
                    // Calculate the offset using the file content
                    const offset = this.getOffset(fileContent, filePath);
    
                    // Construct the sourcekitten command
                    const command = `sourcekitten complete --file ${module.originalPath} --offset ${offset} --spm-module ${module.name} -- ''`;
    
                    // Execute the sourcekitten command and parse the output
                    const output = this.executeCommand(command);
                    const completeSuggestions = JSON.parse(output);
                    this.updateDataset(completeSuggestions);
                } catch (error) {
                    console.error(`Error generating dataset for module ${module.name}: ${error.message}`);
                }
            });
            // Execute all asynchronous tasks concurrently
            await Promise.all(tasks);
        } catch (error) {
            console.error(`Error generating dataset: ${error.message}`);
        }
    }
    
    async initiateBuild() {
        const { spawn } = require('child_process');

        // Create a Promise to await the completion of the build process
        return new Promise((resolve, reject) => {
            console.log(`Initiating build...`);

            // Run swift build
            const buildProcess = spawn('swift', ['build']);

            // Listen for data on stdout and stderr
            buildProcess.stdout.on('data', (data) => {
                // Check if the data contains the "Building" keyword
                if (data.toString().includes('Building')) {
                    buildProcess.kill(); // Kill the swift build process
                    resolve(); // Resolve the Promise to signal completion
                }
            });

            // Listen for errors
            buildProcess.on('error', (error) => {
                console.error(`Error occurred during build: ${error}`);
                reject(error); // Reject the Promise if an error occurs
            });
        });
    }

    /**
     * Execute command method to execute shell commands.
     * @param {string} command - Command to execute.
     * @returns {string} - Output of the executed command.
     */
    executeCommand(command) {
        try {
            const output = execSync(
                command, { 
                    encoding: 'utf-8',
                    maxBuffer: 1024 * 1024 * 1024,
                    stdio: ['pipe', 'pipe', 'pipe'] 
                });
            return output;
        } catch (error) {
            console.log("Error:", error.message);
            return error.message.trim();
        }
    }

    /**
     * Save dataset method to save the dataset to a JSON file.
     */
    async saveDataset() {
        try {
            const data = JSON.stringify(this.componentsDataset, null, 2);
            // Save the updated dataset to the JSON file
            await fs.writeFile(this.datasetFilePath, data);
        } catch (error) {
            console.log(`Error saving dataset: ${error.message}`);
        }
    }



    validPath(directoryPath) {
        // Iterate through each module in the projectModulesList
        for (const module of this.projectModulesList) {
            // Check if the module's path is a subdirectory of the provided directory path
            if (module.path.includes(directoryPath)) {
                return true;
            }
        }
        return false;
    }


    /**
     * Scan files recursively method to recursively scan Swift files in a directory.
     * @param {string} filePath - Path of the file or directory to scan.
     * @param {Array} excludedFolders - Array of folders to exclude from scanning.
     */
    async scanFilesRecursively(filePath, excludedFolders = []) {
        try {
            const stats = await fs.stat(filePath);

            // Check if the item is a directory
            if (stats.isDirectory()) {
                // Check if the provided directory path includes any of the module paths
                const validPath = this.validPath(filePath);
                if (!validPath) {
                    console.log("Directory path does not include any module path. Please provide a valid scan path.");
                    console.log("Available module paths:");
                    this.projectModulesList.forEach(module => console.log(` - ${module.path}`));
                    return;
                }

                // Read the contents of the directory
                const files = await fs.readdir(filePath);

                // Iterate through each item in the directory
                for (const file of files) {
                    const subFilePath = path.join(filePath, file);

                    // Check if the current directory should be excluded
                    if (excludedFolders.includes(file)) {
                        // Skip this directory if it's excluded
                        continue;
                    }

                    // Recursively scan subdirectories or files
                    await this.scanFilesRecursively(subFilePath, excludedFolders);
                }
            } else {
                // Check if the item is a Swift file
                if (filePath.endsWith(".swift")) {
                    // Extract components from the file
                    await this.extractComponentsFromFile(filePath);
                }
            }
        } catch (error) {
            console.log("Error scanning directory:", error.message);
        }
    }

    /**
     * Checks if the provided directory path includes any valid module path.
     * @param {string} directoryPath - The directory path to validate.
     * @returns {boolean} - True if the directory path includes a valid module path, false otherwise.
     */
    validPath(directoryPath) {
        // Iterate through each module in the projectModulesList
        for (const module of this.projectModulesList) {
            // Check if the module's path is a subdirectory of the provided directory path
            if (module.path.includes(directoryPath)) {
                return true;
            }
        }
        return false;
    }



    /**
     * Get project modules list method to get the list of project modules from Swift Package Manager.
     */
    getProjectModulesListFromDescribe() {
        // Define the command to execute
        const command = 'swift package describe --type json';

        // Execute the command using executeCommand method
        const jsonOutput = this.executeCommand(command);

        try {
            // Parse the JSON data from the command output
            const jsonData = JSON.parse(jsonOutput);
            if (!jsonData || typeof jsonData !== 'object') {
                throw new Error('Invalid JSON data');
            }

            // Access the targets array
            const targets = jsonData.targets;

            // Loop through the targets array
            targets.forEach(target => {
                // Access name and path for each target
                const name = target.name;
                const path = target.path;

                // Push name and path to projectModulesList
                this.projectModulesList.push({
                    name: name,
                    path: path
                });
            });

            // Extract third-party dependencies
            this.thirdPartyDependencies = this.extractThirdPartyDependencies(jsonData);
        } catch (error) {
            console.log('Error parsing JSON:', error);
        }
    }
    
    parseAvailableModules(errorMessage) {
        const startIndex = errorMessage.indexOf('Here are the modules available:');
        const endIndex = errorMessage.indexOf('Error: Bad module name');
        if (startIndex !== -1 && endIndex !== -1) {
            const modulesList = errorMessage.substring(startIndex, endIndex)
                .split('\n')
                .slice(1, -1) // Exclude the first and last lines
                .map(line => line.trim().substring(2)); // Remove the bullet points and trim whitespace
            return modulesList;
        } else {
            return [];
        }
    }

    executeCommandSilent(command) {
        try {
            // Execute the command silently and capture both stdout and stderr
            const output = execSync(command, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
            return output;
        } catch (error) {
            return error.stdout + error.stderr; // Return both stdout and stderr if command fails
        }
    }
    
    getSpmModules() {
        try {
            // Run the sourcekitten complete command with an invalid module name to get suggestions
            const command = `sourcekitten complete --text "" --spm-module X24dDW_DCDDD33fdax -- ''`;
            const output = this.executeCommandSilent(command);
    
            // Parse the error message to extract the available modules
            this.availableModules = this.parseAvailableModules(output);
    
        } catch (error) {
            this.logger.log(`Error getting available SPM modules: ${error.message}`);
            return [];
        }
    }
    

    /**
     * Extract third-party dependencies method to extract third-party dependencies from Swift Package Manager data.
     * @param {Object} jsonData - JSON data from Swift Package Manager.
     * @returns {Array} - Array of third-party dependencies.
     */
    extractThirdPartyDependencies(jsonData) {
        const thirdPartyDependencies = [];
        if (!jsonData || !jsonData.dependencies || !Array.isArray(jsonData.dependencies)) {
            console.error('Invalid JSON data for extracting third-party dependencies');
            return thirdPartyDependencies;
        }

        jsonData.dependencies.forEach(dependency => {
            if (dependency.type === "sourceControl") {
                thirdPartyDependencies.push({
                    name: dependency.identity,
                    url: dependency.url
                });
            }
        });
        return thirdPartyDependencies;
    }

    /**
    * Check if a module is a third-party dependency.
    * @param {string} moduleName - Name of the module.
    * @returns {boolean} - True if the module is a third-party dependency, false otherwise.
    */

    

    isThirdParty(moduleName) {
        // Find the module by name
        const module = this.projectModulesList.find(mod => mod.name === moduleName);
        // Return the isThirdParty property if the module is found, otherwise return false
        return module ? module.isThirdParty : false;
    }
    

    /**
     * Get the module name based on the file path.
     * @param {string} filePath - Path of the file.
     * @returns {string|null} - Module name if found, null otherwise.
     */
    getModuleName(filePath) {
        //console.log(filePath);
        const parentDir = path.resolve(filePath);
        //console.log(parentDir);
        for (const module of this.projectModulesList) {
            if (parentDir.includes(module.path)) {
                return module.name;
            }
        }
        return null;
    }

    /**
     * Process the file content to extract components.
     * @param {string} fileContent - Content of the Swift file.
     * @param {string} filePath - Path of the file.
     */
    process(fileContent, filePath) {
        this.extractComponents(filePath, fileContent);
    }

    /**
     * Update the dataset with new components.
     * @param {Array} components - Array of components.
     */
    
    updateDataset(components) {
        components.forEach(component => {
            const moduleName = component.moduleName;
            // Initialize an array for the module name if it doesn't exist
            if (!this.componentsDataset.hasOwnProperty(moduleName)) {
                this.componentsDataset[moduleName] = [];
            }
            // Add the component to the set
            this.componentsDataset[moduleName].push(component);
        });
    }

    /**
     * Get the abstract syntax tree (AST) from the Swift code.
     * @param {string} swiftCode - Swift code.
     * @returns {Node|null} - Root node of the AST if successful, null otherwise.
     */
    getAst(swiftCode) {
        try {
            const tree = this.parser.parse(swiftCode);
            return tree.rootNode;
        } catch (error) {
            console.log("Error:", error.message);
            return null;
        }
    }

    /**
     * Get the offset for a given Swift code and file path.
     * @param {string} swiftCode - Swift code content.
     * @param {string} filePath - Path to the Swift file.
     * @returns {number|null} - Offset within the Swift file or null if an error occurred.
     */
    getOffset(swiftCode, filePath) {
        try {
            // Find the index of the last newline character in the Swift code
            const lastNewlineIndex = swiftCode.lastIndexOf('\n');
            
            if (lastNewlineIndex !== -1) {
                // If newline character found, return its index as the offset
                return lastNewlineIndex;
            } else {
                // If no newline character found, append a newline to the file
                fs.appendFileSync(filePath, '\n', 'utf8');
                
                // Read the updated content of the file
                const updatedContent = fs.readFileSync(filePath, 'utf8');
                
                // Return the length of the updated content as the offset
                return updatedContent.length;
            }
        } catch (error) {
            // Handle errors when reading or appending to the file
            console.error(`Error reading or updating file ${filePath}:`, error.message);
            return null;
        }
    }

    /**
     * Get the imports from the file.
     * @param {Node} node - AST node.
     * @param {Array} importedLibraries - Array to store imported libraries.
     * @returns {Array} - Array of imported libraries.
     */
    getFileImports(node, importedLibraries = []) {
        // Check the type of AST node
        if (node.type === "import_declaration") {
            // If it's an import declaration, extract the imported module name
            const importStatement = node.text.trim();
            const importMatch = importStatement.match(/import\s+([^@\s]+)/);
            if (importMatch && importMatch[1]) {
                const moduleName = importMatch[1].trim();
                importedLibraries.push(moduleName);
            }
        } else if (node.type === "attribute") {
            // If it's an attribute, check if it's a testable import and extract the module name
            const attributeText = node.text.trim();
            if (attributeText.startsWith("@testable import")) {
                const importMatch = attributeText.match(/@testable\s+import\s+([^@\s]+)/);
                if (importMatch && importMatch[1]) {
                    const moduleName = importMatch[1].trim();
                    importedLibraries.push(moduleName);
                }
            }
        }
        // Recursively traverse child nodes to find imports
        node.children.forEach(child => {
            this.getFileImports(child, importedLibraries);
        });
        return importedLibraries;
    }

    /**
     * Extract components from the file structure.
     * @param {Object} fileStructure - Structure of the file.
     * @returns {Array} - Array of extracted components.
     */
    extractComponentsFromStructure(fileStructure) {
        const components = [];
        try {
            // Check if file structure exists and contains substructure
            if (fileStructure && fileStructure["key.substructure"]) {
                const substructure = fileStructure["key.substructure"];
                // Iterate through each component in the substructure
                for (const component of substructure) {
                    // Check if the component kind indicates a valid Swift component
                    if (
                        component["key.kind"].startsWith('source.lang.swift.decl')
                        || component["key.kind"].startsWith('source.lang.swift.expr')
                        || component["key.kind"].startsWith('source.lang.swift.structure')
                    ) {
                        // If valid, push the component to the components array
                        components.push(component);
                    }
                    // Recursively search for components within subcomponents
                    const nestedComponents = this.extractComponentsFromStructure(component);
                    components.push(...nestedComponents);
                }
            }
        } catch (error) {
            console.log(`Error extracting components from structure: ${error.message}`);
        }
        return components;
    }

    /**
     * Extracts components from the specified file.
     * @param {string} filePath - Path of the file to extract components from.
     * @param {string} fileContent - Content of the file.
     */
    async extractComponents(filePath, fileContent) {
        try {
            // Get the structure of the file using sourcekitten
            const fileStructure = await this.getStructureFromFile(filePath);
            // Extract components from the file structure
            const components = this.extractComponentsFromStructure(fileStructure);
            // Process the extracted components
            this.processComponents(components, filePath, fileContent);
        } catch (error) {
            console.log(`Error extracting components from file ${filePath}: ${error.message}`);
        }
    }

    /**
     * Retrieves the structure of the file using sourcekitten.
     * @param {string} filePath - Path of the file.
     * @returns {Object} - Structure of the file.
     * @throws {Error} - If an error occurs during the extraction process.
     */
    async getStructureFromFile(filePath) {
        try {
            const command = `sourcekitten structure --file "${filePath}"`;
            const stdout = await this.executeCommand(command);
            const jsonData = JSON.parse(stdout);
            return jsonData;
        } catch (error) {
            throw new Error(`Error extracting public components: ${error.message}`);
        }
    }

    /**
     * Processes the extracted components by matching them with existing components in the dataset.
     * @param {Array} components - Array of extracted components.
     * @param {string} filePath - Path of the file containing the components.
     * @param {string} fileContent - Content of the file containing the components.
     */
    processComponents(components, filePath, fileContent) {
        // Use a Map to store pre-processed module components for quick access
        const moduleComponentsMap = new Map();
    
        // Pre-process the dataset to reduce complexity in the main loop
        for (const moduleName in this.componentsDataset) {
            const processedComponents = [];
            this.componentsDataset[moduleName].forEach(moduleComponent => {
                if (moduleComponent.name) {
                    processedComponents.push({
                        baseName: moduleComponent.name.split('(')[0].trim(),
                        kind: moduleComponent.kind,
                        isFunc: moduleComponent.kind.includes('function'),
                        fullComponent: moduleComponent
                    });
                }
            });
            moduleComponentsMap.set(moduleName, processedComponents);
        }
    
        // Main loop to process components
        components.forEach(component => {
            const componentName = component['key.name'] && component['key.name'].split('(')[0].trim();
            const componentKind = component['key.kind'];
    
            if (!componentName) return;
    
            moduleComponentsMap.forEach((moduleComponents, moduleName) => {
                for (const { baseName, kind, isFunc, fullComponent} of moduleComponents) {
                    if (baseName === componentName) {
                        if ((isFunc && componentKind.includes('expr')) || kind === componentKind) {
                            const metadata = this.extractMetadata(component, fullComponent, fileContent, filePath);
                            if (metadata) {
                                this.projectComponents.push(metadata);
                            }
                            return; // Return early since we've found a match
                        }
                    }
                }
            });
        });
    }
    
    

    /**
     * Finds the line and column corresponding to the specified offset in the given file.
     * @param {string} fileName - The name of the file.
     * @param {number} offset - The offset in the file.
     * @returns {Object|null} - An object containing the line and column numbers, or null if an error occurs.
     */
    findLineAndColumn(fileName, offset) {
        // Import the 'fs' module
        const fs = require('fs');
        try {
            // Read the content of the file
            const fileContent = fs.readFileSync(fileName, 'utf-8');

            // Initialize variables for line and column numbers
            let line = 1;
            let column = 1;

            // Find the start of the line containing the offset
            let lineStart = offset;
            while (lineStart > 0 && fileContent[lineStart - 1] !== '\n') {
                lineStart--;
            }

            // Calculate the column number
            column = offset - lineStart + 1;

            // Count the number of lines and columns before the offset position
            for (let i = 0; i < lineStart; i++) {
                if (fileContent[i] === '\n') {
                    line++;
                }
            }

            // Return an object containing the line and column numbers
            return { line, column };
        } catch (error) {
            // Handle errors by logging them and returning null
            console.error(`Error reading file ${fileName}:`, error.message);
            return null;
        }
    }


    /**
     * Extracts metadata for the specified component.
     * @param {Object} component - The component object obtained from parsing the source code.
     * @param {Object} existingComponent - The existing component object from the dataset.
     * @param {string} fileContent - The content of the Swift file.
     * @param {string} filePath - The path of the Swift file.
     * @returns {Object} - The extracted metadata for the component.
     */
    extractMetadata(component, existingComponent, fileContent, filePath) {
        try {
            // Extract necessary information from the component and existing component
            const componentName = component["key.name"];
            const componentType = component["key.kind"].replace('source.lang.swift.', '');
            const metadataId = `${existingComponent.moduleName}/${componentName}/${componentType}`;

            // Check if the metadata already exists in the dataset
            let metadata = this.codebaseComponents[metadataId];
            if (!metadata) {
                // If metadata doesn't exist, create a new one
                metadata = {
                    id: metadataId,
                    name: componentName,
                    tags: [],
                    overriddenComponents: {},
                    designSystems: this.getDesignSystems(existingComponent.moduleName),
                    designDocs: existingComponent.docBrief,
                    isSelfDeclared: !this.isThirdParty(existingComponent.moduleName),
                    filewiseOccurences: {},
                    totalOccurences: 0,
                    stories: [],
                    filewiseLocation: {},
                    type: componentType,
                    libraryName: existingComponent.moduleName,
                    thirdParty: this.isThirdParty(existingComponent.moduleName)
                };
            }

            // Update metadata information
            metadata.totalOccurences++;
            metadata.filewiseOccurences[filePath] = (metadata.filewiseOccurences[filePath] || 0) + 1;
            const { line, column } = this.findLineAndColumn(filePath, component["key.offset"]);
            metadata.filewiseLocation[filePath] = [{ line, column, offset: component["key.offset"] } ];

            // Save updated metadata to the dataset
            this.codebaseComponents.push(metadata);
            return metadata;
        } catch (error) {
            console.log(`Error extracting metadata: ${error.message}`);
            return {};
        }
    }


    /**
     * Checks if the specified module belongs to the design system.
     * @param {string} moduleName - Name of the module.
     * @returns {boolean} - True if the module belongs to the design system, false otherwise.
     */
    /**
     * Get the design system(s) matching the given module name.
     * @param {string} moduleName - The name of the module to check.
     * @returns {Array} - An array containing the design system(s) matching the module name.
     */
    getDesignSystems(moduleName) {
        // Convert moduleName to lowercase for case-insensitive comparison
        const lowercaseModuleName = moduleName.toLowerCase();
        
        // Initialize an array to store matched design systems
        const matchedDesignSystems = [];

        // Iterate through each design system module
        for (const designSystemModule of this.designSystemModules) {
            // Convert design system module name to lowercase for comparison
            const lowercaseDesignSystemModule = designSystemModule.toLowerCase();

            // Check if the lowercaseModuleName matches the lowercaseDesignSystemModule
            if (lowercaseDesignSystemModule === lowercaseModuleName) {
                // If matched, push the design system module name to the matchedDesignSystems array
                matchedDesignSystems.push(designSystemModule);
            }
        }

        // Return the array of matched design systems
        return matchedDesignSystems;
    }


    /**
     * Saves the codebase components to a JSON file.
     */
    saveCodebaseComponents() {
        const fs = require('fs');
        try {
            fs.writeFileSync(this.codebaseComponentsPath, JSON.stringify(this.codebaseComponents, null, 2));
        } catch (error) {
            console.log(`Error saving dataset: ${error.message}`);
        }
    }

    /**
     * Extracts components from the specified file.
     * @param {string} filePath - Path of the Swift file to extract components from.
     */
    async extractComponentsFromFile(filePath) {
        console.log(`scanning file: ${filePath}`);
        try {
            // Read the content of the Swift file
            const fileContent = await fs.readFile(filePath, 'utf8');
            // Process the file content
            this.process(fileContent, filePath);
        } catch (error) {
            console.log(`Error scanning Swift file ${filePath}: ${error.message}`);
        }
    }

}

module.exports = SwiftScanner;
// scanner.extractComponentsFromFile('Tests/DownloadTests.swift');
