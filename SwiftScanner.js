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
        this.designSystemModules = [];
        this.thirdPartyDependencies = [];
        this.codebaseComponents = {};
        this.codebaseComponentsPath = "codebase_components.json";
        this.projectComponents = [];
        this.componentsDataset = {};
        this.scannedLibraries = new Set();
        this.datasetFilePath = "components_dataset.json";
        this.parser = new Parser();
        this.parser.setLanguage(Swift);
        this.projectModulesList = [];
    }

    /**
     * Initialize method to initialize the scanner.
     */
    async initialize(designSystemModules = []) {
        try {
            // Initialize project modules list
            //this.getProjectModulesListFromDescribe();
            this.getDebugYaml();
            this.designSystemModules = designSystemModules;
            // Load existing dataset from JSON file if exists
            const datasetContent = await fs.readFile(this.datasetFilePath);
            this.componentsDataset = JSON.parse(datasetContent);
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
            // Save the updated dataset to the JSON file
            await fs.writeFile(this.datasetFilePath, JSON.stringify(this.componentsDataset, null, 2));
        } catch (error) {
            console.log(`Error saving dataset: ${error.message}`);
        }
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
                const moduleName = this.getModuleName(filePath);
                if (!moduleName) {
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
        /*
            {
                name: 'stencilswiftkit',
                url: 'https://github.com/SwiftGen/StencilSwiftKit'
            }
        */
        const lowercaseModuleName = moduleName.toLowerCase();
        for (const dependency of this.thirdPartyDependencies) {
            if (dependency.name.toLowerCase() === lowercaseModuleName) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get the module name based on the file path.
     * @param {string} filePath - Path of the file.
     * @returns {string|null} - Module name if found, null otherwise.
     */
    getModuleName(filePath) {
        //console.log(filePath);
        const parentDir = path.resolve(filePath.replace('./', '').trim());
        //console.log(parentDir);
        for (const module of this.projectModulesList) {
            if (parentDir.includes(module.path)) {
                return module.name;
            }
        }
        return null;
    }
    
    /**
     * Retrieve complete suggestions for a given file and offset.
     * @param {string} filePath - Path to the Swift file.
     * @param {number} offset - Offset within the Swift file.
     * @param {boolean} tried - Flag indicating whether the 'swift build' command has already been attempted.
    * @returns {Object|null} - Complete suggestions or null if an error occurred.
    */
    getCompleteSuggestions(filePath, offset, tried=false) {
        // Get the module name for the provided file path
        const moduleName = this.getModuleName(filePath);
        if (!moduleName) {
            console.log(`Module name not found for file: ${filePath}`);
            return null;
        }
        
        // Construct the sourcekitten command
        const command = `sourcekitten complete --file ${filePath} --offset ${offset} --spm-module ${moduleName} -- ''`;
        //console.log(command);
        try {
            // Execute the sourcekitten command and parse the output
            const output = this.executeCommand(command);
            const completeSuggestions = JSON.parse(output);
            return completeSuggestions;
        } catch (error) {
            // If the error message indicates missing .build/debug.yaml and 'swift build' hasn't been attempted yet
            if (error.message.includes('.build/debug.yaml') && !tried) {
                try {
                    // Execute 'swift build' command with a timeout of 5 seconds
                    execSync('timeout 12s swift build > /dev/null 2>&1');
                } catch (timeoutError) {
                    // Handle timeout error
                    console.error('Timeout waiting for swift build to complete');
                    return null;
                }

                // Retry if the error message does not indicate missing .build/debug.yaml
                return this.getCompleteSuggestions(filePath, offset, true);
            } else {
                // Log and return null for other errors
                console.log("Error:", error.message);
                return null;
            }
        }
    }



    /**
     * Process the file content to extract components.
     * @param {string} fileContent - Content of the Swift file.
     * @param {string} filePath - Path of the file.
     */
    process(fileContent, filePath) {
        const ast = this.getAst(fileContent);
        const importedModules = this.getFileImports(ast);
        const offset = this.getOffset(fileContent, filePath);
        const notInLibraries = importedModules.some(module => !this.scannedLibraries.has(module));
        if (notInLibraries) {
            // Get completion suggestions for the libraries in that file 
            const completeSuggestions = this.getCompleteSuggestions(filePath, offset);
            // Update dataset with new components
            this.updateDataset(completeSuggestions);

            // Update scanned libraries list
            importedModules.forEach(importedModule => this.scannedLibraries.add(importedModule));
        }
        // Now extract components from the file
        this.extractComponents(filePath, fileContent);
    }

    /**
     * Update the dataset with new components.
     * @param {Array} components - Array of components.
     */
    updateDataset(components) {
        components.forEach(component => {
            const moduleName = component.moduleName;
            this.componentsDataset[moduleName] = [...new Set(this.componentsDataset[moduleName]), component];
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
        components.forEach(component => {
            for (const moduleName in this.componentsDataset) {
                    const moduleComponents = this.componentsDataset[moduleName];
                    const componentName = component['key.name'];
                    const componentKind = component['key.kind'];
                    let existingComponent = null;
                    for (const moduleComponent of moduleComponents) {
                        if (moduleComponent.name && componentName) {
                            const baseModuleName = moduleComponent.name.split('(')[0].trim();
                            const baseComponentName = componentName.split('(')[0].trim();
                            const mcIsFunc = moduleComponent.kind.includes('function');
                            if (
                                (baseModuleName === baseComponentName &&
                                mcIsFunc && componentKind.includes('expr'))
                                ||
                                (baseModuleName === baseComponentName &&
                                moduleComponent.kind === componentKind)
                            ) {
                                existingComponent = moduleComponent;
                                break;
                            }
                        }
                    }
                    if (existingComponent) {
                        // console.log(`Found a matching component: ${componentName}`);
                        const metadata = this.extractMetadata(component, existingComponent, fileContent, filePath);
                        if (metadata) {
                            this.projectComponents.push(metadata);
                        }
                        break;
                    }
            }
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
            this.codebaseComponents[metadataId] = metadata;
            this.saveCodebaseComponents();
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
            fs.writeFileSync(this.datasetFilePath, JSON.stringify(this.componentsDataset, null, 2));
        } catch (error) {
            console.log(`Error saving dataset: ${error.message}`);
        }
    }

    /**
     * Extracts components from the specified file.
     * @param {string} filePath - Path of the Swift file to extract components from.
     */
    async extractComponentsFromFile(filePath) {
        try {
            // Read the content of the Swift file
            const fileContent = await fs.readFile(filePath, 'utf8');
            // Process the file content
            this.process(fileContent, filePath);
        } catch (error) {
            console.log(`Error scanning Swift file ${filePath}: ${error.message}`);
        }
    }

    getDebugYaml() {
        const fss = require('fs');
        const yaml = require('js-yaml');

        fss.readFile('.build/debug.yaml', 'utf8', (err, fileData) => {
        if (err) {
            console.error('Error reading file:', err);
            return;
        }

        try {
            // Parse the YAML data
            const data = yaml.load(fileData);
            // Extract the modules from the commands data
            const inputs = data.commands.PackageStructure.inputs;
            const moduleKeys = Object.keys(data.commands).filter(
                key=>key.startsWith('C.')
                );
            // combine modules with paths
            const projectModulesList = {};
            moduleKeys.map(
                mod => projectModulesList[mod.substring(2, mod.lastIndexOf("-"))] = data.commands[mod].inputs[0]
            );
            this.projectModulesList = projectModulesList;


            // filtering third party libraries
            const thirdPartyModuleKeys = moduleKeys.filter(
                mod => data.commands[mod].inputs[0].includes('.build/checkouts')
            );
            
            const thirdPartyDependencies = {};

            thirdPartyModuleKeys.map(
                mod => thirdPartyDependencies[mod.substring(2, mod.lastIndexOf("-"))] = data.commands[mod].inputs[0]
            );
            this.thirdPartyDependencies = thirdPartyDependencies;

        } catch (error) {
            console.error('Error parsing YAML:', error);
        }
        });

    }

}

module.exports = SwiftScanner;
scanner = new SwiftScanner();
scanner.initialize();
scanner.extractComponentsFromFile('Sources/FigmaExportCore/AssetsFilter.swift');
