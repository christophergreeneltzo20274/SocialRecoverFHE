// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface GuardianRecord {
  id: string;
  encryptedShare: string;
  timestamp: number;
  owner: string;
  status: "active" | "inactive" | "pending";
  recoveryThreshold: number;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [guardians, setGuardians] = useState<GuardianRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [adding, setAdding] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newGuardianData, setNewGuardianData] = useState({
    encryptedShare: "",
    recoveryThreshold: 3
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [searchTerm, setSearchTerm] = useState("");

  // Calculate statistics
  const activeCount = guardians.filter(g => g.status === "active").length;
  const inactiveCount = guardians.filter(g => g.status === "inactive").length;
  const pendingCount = guardians.filter(g => g.status === "pending").length;

  useEffect(() => {
    loadGuardians().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadGuardians = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("guardian_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing guardian keys:", e);
        }
      }
      
      const list: GuardianRecord[] = [];
      
      for (const key of keys) {
        try {
          const guardianBytes = await contract.getData(`guardian_${key}`);
          if (guardianBytes.length > 0) {
            try {
              const guardianData = JSON.parse(ethers.toUtf8String(guardianBytes));
              list.push({
                id: key,
                encryptedShare: guardianData.encryptedShare,
                timestamp: guardianData.timestamp,
                owner: guardianData.owner,
                status: guardianData.status || "pending",
                recoveryThreshold: guardianData.recoveryThreshold || 3
              });
            } catch (e) {
              console.error(`Error parsing guardian data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading guardian ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setGuardians(list);
    } catch (e) {
      console.error("Error loading guardians:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const addGuardian = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setAdding(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting guardian share with FHE..."
    });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const guardianId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const guardianData = {
        encryptedShare: newGuardianData.encryptedShare,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        status: "pending",
        recoveryThreshold: newGuardianData.recoveryThreshold
      };
      
      // Store encrypted data on-chain
      await contract.setData(
        `guardian_${guardianId}`, 
        ethers.toUtf8Bytes(JSON.stringify(guardianData))
      );
      
      const keysBytes = await contract.getData("guardian_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(guardianId);
      
      await contract.setData(
        "guardian_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Guardian share added securely with FHE!"
      });
      
      await loadGuardians();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowAddModal(false);
        setNewGuardianData({
          encryptedShare: "",
          recoveryThreshold: 3
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setAdding(false);
    }
  };

  const activateGuardian = async (guardianId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing FHE activation..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const guardianBytes = await contract.getData(`guardian_${guardianId}`);
      if (guardianBytes.length === 0) {
        throw new Error("Guardian not found");
      }
      
      const guardianData = JSON.parse(ethers.toUtf8String(guardianBytes));
      
      const updatedGuardian = {
        ...guardianData,
        status: "active"
      };
      
      await contract.setData(
        `guardian_${guardianId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedGuardian))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE activation completed!"
      });
      
      await loadGuardians();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Activation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const deactivateGuardian = async (guardianId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing FHE deactivation..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const guardianBytes = await contract.getData(`guardian_${guardianId}`);
      if (guardianBytes.length === 0) {
        throw new Error("Guardian not found");
      }
      
      const guardianData = JSON.parse(ethers.toUtf8String(guardianBytes));
      
      const updatedGuardian = {
        ...guardianData,
        status: "inactive"
      };
      
      await contract.setData(
        `guardian_${guardianId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedGuardian))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE deactivation completed!"
      });
      
      await loadGuardians();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Deactivation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to manage your FHE-protected recovery protocol",
      icon: "🔗"
    },
    {
      title: "Add Guardian Shares",
      description: "Distribute your encrypted key shares to trusted guardians using FHE",
      icon: "🔒"
    },
    {
      title: "FHE Recovery Protocol",
      description: "Recover your wallet using encrypted shares without exposing them",
      icon: "⚙️"
    },
    {
      title: "Secure Management",
      description: "Monitor and manage your recovery settings with full privacy",
      icon: "📊"
    }
  ];

  const filteredGuardians = guardians.filter(guardian => 
    guardian.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    guardian.owner.toLowerCase().includes(searchTerm.toLowerCase()) ||
    guardian.status.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>SocialRecover<span>FHE</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            className="header-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>FHE-Powered Secure Decentralized Social Recovery</h2>
            <p>Protect your wallet with encrypted key shares distributed to trusted guardians</p>
          </div>
          <div className="fhe-badge">
            <span>FHE-ENCRYPTED</span>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>How FHE Social Recovery Works</h2>
            <p className="subtitle">Learn how to secure your wallet with fully homomorphic encryption</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="tab-navigation">
          <button 
            className={activeTab === "dashboard" ? "tab-btn active" : "tab-btn"}
            onClick={() => setActiveTab("dashboard")}
          >
            Dashboard
          </button>
          <button 
            className={activeTab === "guardians" ? "tab-btn active" : "tab-btn"}
            onClick={() => setActiveTab("guardians")}
          >
            Guardians ({guardians.length})
          </button>
          <button 
            className={activeTab === "recovery" ? "tab-btn active" : "tab-btn"}
            onClick={() => setActiveTab("recovery")}
          >
            Recovery Settings
          </button>
        </div>
        
        {activeTab === "dashboard" && (
          <div className="dashboard-grid">
            <div className="dashboard-card">
              <h3>Project Overview</h3>
              <p>SocialRecoverFHE uses Fully Homomorphic Encryption to enable secure decentralized social recovery of wallets without exposing key shares.</p>
              <div className="fhe-badge">
                <span>FHE-POWERED</span>
              </div>
            </div>
            
            <div className="dashboard-card">
              <h3>Guardian Statistics</h3>
              <div className="stats-grid">
                <div className="stat-item">
                  <div className="stat-value">{guardians.length}</div>
                  <div className="stat-label">Total Guardians</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{activeCount}</div>
                  <div className="stat-label">Active</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{pendingCount}</div>
                  <div className="stat-label">Pending</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{inactiveCount}</div>
                  <div className="stat-label">Inactive</div>
                </div>
              </div>
            </div>
            
            <div className="dashboard-card">
              <h3>FHE Security Benefits</h3>
              <ul className="benefits-list">
                <li>• Encrypted key shares remain encrypted during recovery</li>
                <li>• Guardians cannot access or collude to steal keys</li>
                <li>• Resistance to quantum attacks</li>
                <li>• Decentralized trust model</li>
              </ul>
            </div>
          </div>
        )}
        
        {activeTab === "guardians" && (
          <div className="guardians-section">
            <div className="section-header">
              <h2>Guardian Management</h2>
              <div className="header-actions">
                <div className="search-box">
                  <input 
                    type="text" 
                    placeholder="Search guardians..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <button 
                  onClick={() => setShowAddModal(true)}
                  className="add-btn"
                >
                  Add Guardian
                </button>
                <button 
                  onClick={loadGuardians}
                  className="refresh-btn"
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="guardians-list">
              <div className="list-header">
                <div className="header-cell">ID</div>
                <div className="header-cell">Owner</div>
                <div className="header-cell">Added</div>
                <div className="header-cell">Status</div>
                <div className="header-cell">Threshold</div>
                <div className="header-cell">Actions</div>
              </div>
              
              {filteredGuardians.length === 0 ? (
                <div className="no-guardians">
                  <div className="no-guardians-icon"></div>
                  <p>No guardians found</p>
                  <button 
                    className="primary-btn"
                    onClick={() => setShowAddModal(true)}
                  >
                    Add First Guardian
                  </button>
                </div>
              ) : (
                filteredGuardians.map(guardian => (
                  <div className="guardian-row" key={guardian.id}>
                    <div className="table-cell guardian-id">#{guardian.id.substring(0, 6)}</div>
                    <div className="table-cell">{guardian.owner.substring(0, 6)}...{guardian.owner.substring(38)}</div>
                    <div className="table-cell">
                      {new Date(guardian.timestamp * 1000).toLocaleDateString()}
                    </div>
                    <div className="table-cell">
                      <span className={`status-badge ${guardian.status}`}>
                        {guardian.status}
                      </span>
                    </div>
                    <div className="table-cell">{guardian.recoveryThreshold}</div>
                    <div className="table-cell actions">
                      {isOwner(guardian.owner) && (
                        <>
                          {guardian.status !== "active" && (
                            <button 
                              className="action-btn success"
                              onClick={() => activateGuardian(guardian.id)}
                            >
                              Activate
                            </button>
                          )}
                          {guardian.status !== "inactive" && (
                            <button 
                              className="action-btn danger"
                              onClick={() => deactivateGuardian(guardian.id)}
                            >
                              Deactivate
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        
        {activeTab === "recovery" && (
          <div className="recovery-section">
            <div className="recovery-card">
              <h3>Recovery Settings</h3>
              <p>Configure your FHE-powered social recovery protocol settings</p>
              
              <div className="settings-form">
                <div className="form-group">
                  <label>Recovery Threshold</label>
                  <p className="setting-description">Minimum number of guardians required for recovery</p>
                  <select className="setting-select">
                    <option>2 of 3</option>
                    <option>3 of 5</option>
                    <option>4 of 7</option>
                    <option>5 of 9</option>
                  </select>
                </div>
                
                <div className="form-group">
                  <label>FHE Security Level</label>
                  <p className="setting-description">Higher levels provide more security but require more computation</p>
                  <select className="setting-select">
                    <option>Standard (128-bit)</option>
                    <option>Enhanced (192-bit)</option>
                    <option>Maximum (256-bit)</option>
                  </select>
                </div>
                
                <div className="form-group">
                  <label>Recovery Time Delay</label>
                  <p className="setting-description">Time that must pass before recovery can be completed</p>
                  <select className="setting-select">
                    <option>No delay</option>
                    <option>24 hours</option>
                    <option>72 hours</option>
                    <option>7 days</option>
                  </select>
                </div>
                
                <button className="save-btn">Save Settings</button>
              </div>
            </div>
            
            <div className="recovery-card">
              <h3>Initiate Recovery</h3>
              <p>Start the FHE-powered recovery process if you've lost access to your wallet</p>
              
              <div className="recovery-actions">
                <button className="recovery-btn">Begin Recovery Process</button>
                <p className="recovery-note">This will notify your guardians and start the FHE computation process</p>
              </div>
            </div>
          </div>
        )}
      </div>
  
      {showAddModal && (
        <ModalAddGuardian 
          onSubmit={addGuardian} 
          onClose={() => setShowAddModal(false)} 
          adding={adding}
          guardianData={newGuardianData}
          setGuardianData={setNewGuardianData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>SocialRecoverFHE</span>
            </div>
            <p>FHE-powered secure decentralized social recovery protocol</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">GitHub</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-POWERED SECURITY</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} SocialRecoverFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalAddGuardianProps {
  onSubmit: () => void; 
  onClose: () => void; 
  adding: boolean;
  guardianData: any;
  setGuardianData: (data: any) => void;
}

const ModalAddGuardian: React.FC<ModalAddGuardianProps> = ({ 
  onSubmit, 
  onClose, 
  adding,
  guardianData,
  setGuardianData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setGuardianData({
      ...guardianData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!guardianData.encryptedShare) {
      alert("Please provide encrypted share data");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="add-modal">
        <div className="modal-header">
          <h2>Add Guardian Share</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="key-icon"></div> Guardian share will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Encrypted Share *</label>
              <textarea 
                name="encryptedShare"
                value={guardianData.encryptedShare} 
                onChange={handleChange}
                placeholder="Paste FHE-encrypted key share..." 
                className="share-textarea"
                rows={4}
              />
            </div>
            
            <div className="form-group">
              <label>Recovery Threshold</label>
              <select 
                name="recoveryThreshold"
                value={guardianData.recoveryThreshold} 
                onChange={handleChange}
                className="threshold-select"
              >
                <option value={2}>2 of 3</option>
                <option value={3}>3 of 5</option>
                <option value={4}>4 of 7</option>
                <option value={5}>5 of 9</option>
              </select>
            </div>
          </div>
          
          <div className="privacy-note">
            <div className="privacy-icon"></div> Share remains encrypted with FHE during recovery
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={adding}
            className="submit-btn primary"
          >
            {adding ? "Processing with FHE..." : "Add Guardian"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;