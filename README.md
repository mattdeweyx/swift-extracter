# Swift Code Scanner CLI

## Installation:
Install sourcekitten
```
git clone https://github.com/jpsim/SourceKitten
cd SourceKitten
swift build
```


## Usage:
### creating a test envoirenment:
to quickly setup a test envoirment we can run a docker container with Swift compiler and sourcekitten library pre-installed
we can do this by 
```
docker run --privileged --interactive --tty \
    --name swift-sourcekitten mattdeweyx/test-sourcekitten /bin/bash
```
we then run the command to scan a file/folder in a certain swift project

### Scan Swift Project Files:
```
node ScannerCLI.js scan <filePath...> [options]
```

### Scan Swift Project Directory:
```
node ScannerCLI.js scan <directory...> [options]
```

Scan Swift files and extract components. Provide one or more file paths to be scanned.

## Options:
- -d, --design <design>: Specify design system modules (comma-separated)
- -e, --exclude <exclude>: Exclude folders (comma-separated)

## Examples:
```
node ScannerCLI.js scan -d UIKit,CoreData -e Tests,ThirdParty Sources/ExampleProject/File1.swift Sources/ExampleProject/Folder1
node ScannerCLI.js scan Sources/ExampleProject/File1.swift
```

### Get Available SPM Modules:
```
node ScannerCLI.js modules
```
Retrieve available Swift Package Manager (SPM) modules in the project.

## Example:
```
node ScannerCLI.js modules
node ScannerCLI.js scan -d UIKit,CoreData -e Tests,ThirdParty Sources/ExampleProject/File1.swift Sources/ExampleProject/Folder1
node ScannerCLI.js scan Sources/ExampleProject/File1.swift
node ScannerCLI.js scan Sources/ExampleProject
```
results for the components found in the project to "codebase_components.json"
to upload the file we can use termbin.com to get a sharable link
```
cat codebase_components.json | nc termbin.com 9999
```

### Additional Information:

For more information and examples, refer to the help documentation:
```
node ScannerCLI.js --help
```

# SwiftScanner Documentation

**Description:**
The SwiftScanner class is designed for scanning Swift files and extracting components. It leverages the Tree-sitter library for parsing Swift code and SourceKitten for extracting detailed information about Swift source code.

**Dependencies:**
- child_process: To execute shell commands.
- tree-sitter: A parsing library for creating abstract syntax trees (ASTs) from source code.
- tree-sitter-swift: Tree-sitter grammar for Swift language.
- fs: File system module for file operations.
- path: Module for handling file paths.
- js-yaml: YAML parser and serializer.

**Class Structure:**
- **Constructor:**
  - Initializes properties and sets up the parser with the Swift language.

- **Methods:**
  - `initialize(designSystemModules=[])`:
    - Initializes the scanner, triggers build initiation, and retrieves project modules list from the debug.yaml file.
  - `loadDataset()`:
    - Loads the dataset from the components_dataset.json file.
  - `generateDataset()`:
    - Generates a dataset of importable components by querying SourceKitten for code suggestions.
  - `initiateBuild()`:
    - Initiates a Swift build process to collect project dependencies and package structure.
  - `executeCommand(command)`:
    - Executes shell commands and returns the output.
  - `saveDataset()`:
    - Saves the dataset to a JSON file.
  - `validPath(directoryPath)`:
    - Checks if a directory path includes any valid module path.
  - `scanFilesRecursively(filePath, excludedFolders=[])`:
    - Recursively scans Swift files in a directory.
  - `extractComponentsFromFile(filePath)`:
    - Extracts components from a Swift file.
  - `getStructureFromFile(filePath)`:
    - Retrieves the structure of a Swift file using SourceKitten.
  - `processComponents(components, filePath, fileContent)`:
    - Processes the extracted components.
  - `extractMetadata(component, existingComponent, fileContent, filePath)`:
    - Extracts metadata for the specified component.
  - `findLineAndColumn(fileName, offset)`:
    - Finds the line and column corresponding to the specified offset in a file.
  - `getModuleName(filePath)`:
    - Gets the module name based on the file path.
  - `getAst(swiftCode)`:
    - Gets the abstract syntax tree (AST) from Swift code.
  - `getFileImports(node, importedLibraries=[])`:
    - Gets the imports from the file.
  - `extractThirdPartyDependencies(jsonData)`:
    - Extracts third-party dependencies from Swift Package Manager data.
  - `isThirdParty(moduleName)`:
    - Checks if a module is a third-party dependency.
  - `parseAvailableModules(errorMessage)`:
    - Parses the error message to extract available modules.
  - `executeCommandSilent(command)`:
    - Executes a command silently and captures both stdout and stderr.
  - `getSpmModules()`:
    - Gets available Swift Package Manager (SPM) modules.

**Usage:**
- Import the SwiftScanner class into your project.
- Create an instance of SwiftScanner.
- Initialize the scanner using the initialize() method.
- Use the generateDataset() method to generate a dataset of importable components.
- Use the scanFilesRecursively() method to scan Swift files in a directory.
- Use the modules() method to retrieve available SPM modules.

**Example:**
```
const SwiftScanner = require('./SwiftScanner');
const scanner = new SwiftScanner();
scanner.initialize(designSystemModules);
scanner.generateDataset();
scanner.scanFilesRecursively('path/to/directory');
scanner.modules();
```
